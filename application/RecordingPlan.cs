namespace IndependentCenter;

public enum RecordingMode { Continuous, Scheduled }
public sealed class RecordingPeriod
{
    public DayOfWeek Day { get; set; }
    public int StartMinute { get; set; }
    public int EndMinute { get; set; } = 1440;
}
public sealed class RecordingPlan
{
    public bool Enabled { get; set; }
    public RecordingMode Mode { get; set; }
    public List<RecordingPeriod> Periods { get; set; } = [];
    public int RetentionHours { get; set; } // zero disables automatic expiry
    public void Validate()
    {
        if (!Enum.IsDefined(Mode) || RetentionHours < 0 || RetentionHours > 87623)
            throw new ArgumentException("Modo ou retenção inválidos.");
        if (Periods.Any(p => !Enum.IsDefined(p.Day) || p.StartMinute < 0 || p.EndMinute > 1440 || p.StartMinute >= p.EndMinute))
            throw new ArgumentException("Cada período precisa de início anterior ao fim, entre 00:00 e 24:00.");
        foreach (var day in Periods.GroupBy(p => p.Day))
        {
            var ordered = day.OrderBy(p => p.StartMinute).ToArray();
            if (ordered.Length > 3) throw new ArgumentException("Use no máximo três períodos por dia.");
            for (int i = 1; i < ordered.Length; i++)
                if (ordered[i].StartMinute < ordered[i - 1].EndMinute) throw new ArgumentException("Os períodos do mesmo dia não podem se sobrepor.");
        }
        if (Enabled && Mode == RecordingMode.Scheduled && Periods.Count == 0)
            throw new ArgumentException("Adicione pelo menos um período à gravação programada.");
    }
    public bool IsDue(DateTime localTime) => Enabled && (Mode == RecordingMode.Continuous ||
        Periods.Any(p => p.Day == localTime.DayOfWeek && localTime.TimeOfDay.TotalMinutes >= p.StartMinute && localTime.TimeOfDay.TotalMinutes < p.EndMinute));
}

public sealed class AutomaticRecording : IDisposable
{
    readonly Store store;
    readonly RecordingService recorder;
    readonly Func<Guid, bool> emergency;
    readonly Dictionary<Guid, DateTimeOffset> retry = [];
    DateTimeOffset nextTick, nextRetention;
    public AutomaticRecording(Store store, LibVLCSharp.Shared.LibVLC engine, Func<Guid, bool> emergency)
    { this.store = store; this.emergency = emergency; recorder = new(store, engine, false); }
    public bool IsRecording(Guid id) => recorder.IsRecording(id);
    public void Suspend(Guid id) => recorder.Stop(id);
    public void Tick(DateTimeOffset now)
    {
        if (now < nextTick) return;
        nextTick = now.AddSeconds(1);
        recorder.Tick();
        foreach (var id in recorder.CameraIds.Where(id => !store.Data.Cameras.Any(c => c.Id == id)).ToArray()) recorder.Stop(id);
        foreach (var camera in store.Data.Cameras)
        {
            bool due;
            try { camera.Recording.Validate(); due = camera.Recording.IsDue(now.LocalDateTime); }
            catch (ArgumentException) { due = false; }
            if (!due || emergency(camera.Id)) { recorder.Stop(camera.Id); continue; }
            if (!recorder.IsRecording(camera.Id) && (!retry.TryGetValue(camera.Id, out var at) || now >= at))
            {
                retry[camera.Id] = now.AddSeconds(store.Data.ReconnectSeconds);
                try { recorder.Start(camera, TimeSpan.FromMinutes(5)); }
                catch (Exception e) { store.Log("Falha na gravação automática " + camera.Id + ": " + e.GetType().Name); }
            }
        }
        if (now >= nextRetention)
        {
            nextRetention = now.AddMinutes(1);
            foreach (var camera in store.Data.Cameras.Where(c => c.Recording.RetentionHours > 0))
                RecordingRetention.Clean(store, camera, now);
        }
    }
    public void Dispose() => recorder.Dispose();
}
