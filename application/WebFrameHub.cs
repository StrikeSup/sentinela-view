using LibVLCSharp.Shared;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace IndependentCenter;

// One decoder per camera shared by all web viewers. No dependency on monitor cells.
public sealed class WebFrameHub : IDisposable
{
    readonly LibVLC engine;
    readonly object gate = new();
    readonly Dictionary<Guid, Session> sessions = [];
    readonly System.Threading.Timer cleanup;
    bool disposed;
    public const int Capacity = 4;
    public WebFrameHub(LibVLC engine) { this.engine = engine; cleanup = new(_ => Sweep(), null, 5000, 5000); }
    public byte[]? Frame(Camera camera)
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (sessions.TryGetValue(camera.Id, out var old) && !old.Matches(camera)) { sessions.Remove(camera.Id); old.Dispose(); }
            if (!sessions.TryGetValue(camera.Id, out var session))
            {
                SweepLocked();
                if (sessions.Count >= Capacity) throw new InvalidOperationException("Limite de quatro câmeras web simultâneas. Feche outra visualização e aguarde 30 segundos.");
                session = new(engine, camera); sessions.Add(camera.Id, session);
            }
            session.Touch(); return session.Frame;
        }
    }
    public int ActiveCount { get { lock (gate) return sessions.Count; } }
    public string Status(Guid id) { lock (gate) return sessions.TryGetValue(id, out var s) ? s.Status : "Idle"; }
    void Sweep() { lock (gate) { if (!disposed) SweepLocked(); } }
    void SweepLocked()
    {
        foreach (var id in sessions.Where(p => DateTime.UtcNow - p.Value.LastRequest > TimeSpan.FromSeconds(30)).Select(p => p.Key).ToArray())
        { var session = sessions[id]; sessions.Remove(id); session.Dispose(); }
    }
    public void Dispose()
    {
        lock (gate) { if (disposed) return; disposed = true; cleanup.Dispose(); foreach (var s in sessions.Values) s.Dispose(); sessions.Clear(); }
    }
    sealed class Session : IDisposable
    {
        readonly MediaPlayer player;
        readonly LibVLC engine;
        readonly Camera camera;
        readonly object frameGate = new();
        readonly IntPtr buffer;
        byte[]? frame;
        DateTime captured, attempted;
        public DateTime LastRequest { get; private set; }
        public string Status => player.State.ToString();
        public byte[]? Frame { get { lock (frameGate) return DateTime.UtcNow - captured < TimeSpan.FromSeconds(3) ? frame : null; } }
        public bool Matches(Camera c) => c.Source == camera.Source && c.User == camera.User && c.ProtectedPassword == camera.ProtectedPassword && c.DeviceConnector==camera.DeviceConnector && c.DeviceAddress==camera.DeviceAddress;
        public Session(LibVLC engine, Camera camera)
        {
            this.engine = engine; this.camera = camera; buffer = Marshal.AllocHGlobal(1280 * 720 * 4);
            player = new(engine) { Mute = true };
            try
            {
                player.SetVideoFormat("RV32", 1280, 720, 1280 * 4);
                player.SetVideoCallbacks((_, planes) => { Monitor.Enter(frameGate); Marshal.WriteIntPtr(planes, buffer); return IntPtr.Zero; },
                    (_, _, _) => Monitor.Exit(frameGate), (_, _) => Capture());
                Start();
            }
            catch { player.Dispose(); Marshal.FreeHGlobal(buffer); throw; }
        }
        void Capture()
        {
            lock (frameGate)
            {
                if (DateTime.UtcNow - captured < TimeSpan.FromMilliseconds(100)) return;
                try
                {
                    using var bitmap = new Bitmap(1280, 720, 1280 * 4, PixelFormat.Format32bppRgb, buffer);
                    using var stream = new MemoryStream(); using var quality = new EncoderParameters(1); quality.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L); bitmap.Save(stream, ImageCodecInfo.GetImageEncoders().Single(c => c.FormatID == ImageFormat.Jpeg.Guid), quality);
                    frame = stream.ToArray(); captured = DateTime.UtcNow;
                }
                catch (ExternalException) { frame = null; }
            }
        }
        void Start()
        {
            attempted = DateTime.UtcNow;
            using var media = new Media(engine, IntelbrasCloudTransport.Resolve(camera), File.Exists(camera.Source) ? FromType.FromPath : FromType.FromLocation);
            media.AddOption(":network-caching=500"); media.AddOption(":rtsp-tcp"); media.AddOption(":no-audio");
            if (File.Exists(camera.Source)) media.AddOption(":input-repeat=-1");
            if (camera.User.Length > 0)
            {
                media.AddOption(":rtsp-user=" + camera.User); media.AddOption(":rtsp-pwd=" + camera.Password);
                media.AddOption(":http-user=" + camera.User); media.AddOption(":http-pwd=" + camera.Password);
            }
            player.Play(media);
        }
        public void Touch()
        {
            LastRequest = DateTime.UtcNow;
            if ((File.Exists(camera.Source) && player.State == VLCState.Ended) || (DateTime.UtcNow - attempted > TimeSpan.FromSeconds(60) && Frame is null)) { player.Stop(); Start(); }
        }
        public void Dispose() { player.Stop(); player.Dispose(); Marshal.FreeHGlobal(buffer); }
    }
}


