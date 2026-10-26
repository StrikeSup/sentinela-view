using LibVLCSharp.Shared;
namespace IndependentCenter;
public sealed class RecordingService : IDisposable
{
    sealed class Session : IDisposable
    {
        public required MediaPlayer Player; public required string Path; public DateTimeOffset? Expires; public Guid CameraId;
        public void Dispose() { Player.Stop(); Player.Dispose(); }
    }
    readonly Dictionary<Guid, Session> sessions = []; readonly Store store; readonly LibVLC engine; readonly bool persistEmergency;
    DateTime nextDiskCheck = DateTime.MinValue;
    public RecordingService(Store store, LibVLC engine, bool persistEmergency = true) { this.store = store; this.engine = engine; this.persistEmergency = persistEmergency; }
    public IReadOnlyCollection<Guid> CameraIds => sessions.Keys;
    public void Restore()
    {
        if (!persistEmergency) return;
        foreach (var state in store.Data.EmergencyRecordings.ToArray())
        {
            var camera = store.Data.Cameras.FirstOrDefault(c => c.Id == state.CameraId);
            if (camera is null || state.Expires <= DateTimeOffset.Now) { store.Data.EmergencyRecordings.Remove(state); continue; }
            try { Start(camera, state.Expires is { } expiry ? expiry - DateTimeOffset.Now : null); } catch (Exception e) { store.Log("Não foi possível retomar gravação " + state.CameraId + ": " + e.GetType().Name); }
        }
        store.Save();
    }
    public bool IsRecording(Guid id) => sessions.ContainsKey(id);
    public string Start(Camera camera, TimeSpan? duration)
    {
        var driveRoot = Path.GetPathRoot(Path.GetFullPath(store.Data.RecordingDirectory));
        if (driveRoot is not null && new DriveInfo(driveRoot).AvailableFreeSpace < 100L * 1024 * 1024) throw new IOException("Espaço livre insuficiente para gravação (mínimo 100 MB).");
        Stop(camera.Id);
        var directory = Path.Combine(store.Data.RecordingDirectory, camera.Id.ToString()); Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + "_" + Guid.NewGuid().ToString("N") + ".ts");
        var player = new MediaPlayer(engine);
        using var media = new Media(engine, IntelbrasCloudTransport.Resolve(camera), File.Exists(camera.Source) ? FromType.FromPath : FromType.FromLocation);
        media.AddOption(":rtsp-tcp"); media.AddOption(":sout=#duplicate{dst=std{access=file,mux=ts,dst='" + path.Replace("\\", "/").Replace("'", "\\'") + "'},dst=display}"); media.AddOption(":vout=dummy"); media.AddOption(":aout=dummy"); media.AddOption(":sout-keep");
        if (camera.User.Length > 0) { media.AddOption(":rtsp-user=" + camera.User); media.AddOption(":rtsp-pwd=" + camera.Password); media.AddOption(":http-user=" + camera.User); media.AddOption(":http-pwd=" + camera.Password); }
        if (!player.Play(media)) { player.Dispose(); throw new IOException("Não foi possível iniciar a gravação."); }
        sessions[camera.Id] = new() { Player = player, Path = path, CameraId = camera.Id, Expires = duration.HasValue ? DateTimeOffset.Now + duration.Value : null }; store.Log("Gravação solicitada: " + camera.Id);
        if (persistEmergency) {
        store.Data.EmergencyRecordings.RemoveAll(r => r.CameraId == camera.Id);
        store.Data.EmergencyRecordings.Add(new() { CameraId = camera.Id, Expires = sessions[camera.Id].Expires }); store.Save();
        }
        return path;
    }
    void Finish(Session session)
    {
        session.Dispose();
        try { RecordingRetention.MarkCompleted(session.Path, session.CameraId, DateTimeOffset.UtcNow); }
        catch (Exception e) { store.Log("Índice de retenção não gravado: " + e.GetType().Name); }
    }
    public void Stop(Guid id) { if (sessions.Remove(id, out var s)) { Finish(s); store.Log("Gravação encerrada: " + id); } if (persistEmergency && store.Data.EmergencyRecordings.RemoveAll(r => r.CameraId == id) > 0) store.Save(); }
    public void Tick()
    {
        if (sessions.Count > 0 && DateTime.UtcNow >= nextDiskCheck) { nextDiskCheck = DateTime.UtcNow.AddSeconds(10); var root = Path.GetPathRoot(Path.GetFullPath(store.Data.RecordingDirectory)); if (root is not null && new DriveInfo(root).AvailableFreeSpace < 50L * 1024 * 1024) { foreach (var id in sessions.Keys.ToArray()) Stop(id); store.Log("Gravações interrompidas: espaço livre abaixo de 50 MB."); } }
        foreach (var id in sessions.Where(p => (p.Value.Expires is { } e && DateTimeOffset.Now >= e) || p.Value.Player.State is VLCState.Error or VLCState.Ended).Select(p => p.Key).ToArray()) { if (sessions[id].Player.State == VLCState.Error) store.Log("Falha no fluxo de gravação: " + id); Stop(id); }
    }
    public void Dispose() { foreach (var s in sessions.Values) Finish(s); sessions.Clear(); }
}

