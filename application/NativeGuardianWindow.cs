using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;
using System.Diagnostics;
using System.Text.Json;

namespace IndependentCenter;

// Native HWND video surfaces: no browser, WebRTC relay or intermediate encoder.
public sealed class NativeGuardianWindow : Form
{
    readonly LibVLC engine;
    readonly Func<Task<WebCatalog>> catalog;
    readonly CheckedListBox cameras = new() { Dock = DockStyle.Fill, CheckOnClick = true };
    readonly TableLayoutPanel grid = new() { Dock = DockStyle.Fill, BackColor = Color.Black };
    readonly List<NativeVideoTile> tiles = [];
    readonly Label summary = new() { Dock = DockStyle.Bottom, Height = 28 };
    readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    readonly NotifyIcon tray;
    bool quitting;
    public NativeGuardianWindow(LibVLC engine, Func<Task<WebCatalog>> catalog, string address, bool diagnostic = false, int testCount = 4)
    {
        this.engine = engine; this.catalog = catalog;
        Text = "Sentinela VIEW — monitor nativo e servidor"; Width = 1400; Height = 900;
        BackColor = Color.FromArgb(20, 24, 29); ForeColor = Color.White;
        var icon = Path.Combine(AppContext.BaseDirectory, "guardian.ico"); if (File.Exists(icon)) Icon = new Icon(icon);
        var sidebar = new Panel { Dock = DockStyle.Left, Width = 290, Padding = new Padding(10) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 150 };
        void Button(string text, Action action) { var b = new Button { Text = text, Width = 125, Height = 34 }; b.Click += (_, _) => action(); buttons.Controls.Add(b); }
        Button("Abrir selecionadas", OpenSelected);
        Button("Parar imagens", StopTiles);
        Button("Atualizar cadastro", () => _ = Reload());
        Button("Selecionar todas", () => { for(int i=0;i<cameras.Items.Count;i++)cameras.SetItemChecked(i,true); });
        Button("Administração", () => Process.Start(new ProcessStartInfo(address + "/dvrs") { UseShellExecute = true }));
        cameras.BackColor = BackColor; cameras.ForeColor = ForeColor; cameras.BorderStyle = BorderStyle.None;
        sidebar.Controls.Add(cameras); sidebar.Controls.Add(buttons);
        sidebar.Controls.Add(new Label { Text = "SENTINELA VIEW\nVisualização nativa", Dock = DockStyle.Top, Height = 60, Font = new Font("Segoe UI", 13) });
        Controls.Add(grid); Controls.Add(summary); Controls.Add(sidebar);
        var menu = new ContextMenuStrip(); menu.Items.Add("Abrir monitor", null, (_, _) => { Show(); Activate(); });
        menu.Items.Add("Encerrar servidor", null, (_, _) => { quitting = true; Close(); });
        tray = new NotifyIcon { Icon = Icon, Text = "Sentinela VIEW — servidor nativo", ContextMenuStrip = menu, Visible = !diagnostic };
        tray.DoubleClick += (_, _) => { Show(); Activate(); };
        FormClosing += (_, e) => { if (!diagnostic && !quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        timer.Tick += (_, _) => { foreach (var tile in tiles) tile.Check(); summary.Text = $"Vídeo nativo · imagens atualizando: {tiles.Count(t => t.Fresh)}/{tiles.Count} · sem conversão intermediária";
            if(diagnostic)File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"native-video-progress.json"),JsonSerializer.Serialize(Diagnostics())); };
        Shown += async (_, _) => { await Reload(); if (diagnostic) { for (int i = 0; i < Math.Min(testCount, cameras.Items.Count); i++) cameras.SetItemChecked(i, true); OpenSelected(); } timer.Start(); };
    }
    async Task Reload()
    {
        try { var data = await catalog(); cameras.Items.Clear(); foreach (var c in data.Cameras) cameras.Items.Add(c); }
        catch { summary.Text = "Não foi possível ler o cadastro local."; }
    }
    void OpenSelected()
    {
        var selected = cameras.CheckedItems.Cast<Camera>().ToArray(); StopTiles();
        if (selected.Length == 0) return;
        int columns = (int)Math.Ceiling(Math.Sqrt(selected.Length)), rows = (int)Math.Ceiling((double)selected.Length / columns);
        grid.ColumnCount = columns; grid.RowCount = rows; grid.ColumnStyles.Clear(); grid.RowStyles.Clear();
        for (int i = 0; i < columns; i++) grid.ColumnStyles.Add(new(SizeType.Percent, 100f / columns));
        for (int i = 0; i < rows; i++) grid.RowStyles.Add(new(SizeType.Percent, 100f / rows));
        foreach (var camera in selected) { var tile = new NativeVideoTile(engine, camera, "extra") { Dock = DockStyle.Fill }; tiles.Add(tile); grid.Controls.Add(tile); tile.Start(); }
    }
    void StopTiles() { foreach (var t in tiles) t.Dispose(); tiles.Clear(); grid.Controls.Clear(); }
    public object[] Diagnostics() { NativeDecodeProbe.Save(); return tiles.Select(t => t.Diagnostics()).ToArray(); }
    protected override void Dispose(bool disposing) { if (disposing) { timer.Dispose(); StopTiles(); tray.Dispose(); } base.Dispose(disposing); }
}

public sealed class NativeVideoTile : UserControl
{
    readonly LibVLC engine;
    readonly Camera camera;
    readonly MediaPlayer player;
    readonly VideoView view;
    readonly Label status = new() { Dock = DockStyle.Bottom, Height = 24, ForeColor = Color.White, BackColor = Color.FromArgb(30, 35, 41) };
    readonly Stopwatch elapsed = Stopwatch.StartNew();
    Media? media;
    DateTime lastFrame, attempt;
    long pictures;
    long firstFrameMs = -1;
    int route, retries;
    bool connecting, disposed, retiring;
    public bool HasStarted {get;private set;}
    Task retirement=Task.CompletedTask;
    public async Task RetireAsync(){if(retiring||disposed)return;retiring=true;lifetime.Cancel();Visible=false;retirement=Task.Run(async()=>{await stopTask.ConfigureAwait(false);player.Stop();});await retirement;Dispose();}
    volatile bool failed;
    Task stopTask = Task.CompletedTask;
    readonly CancellationTokenSource lifetime = new();
    public bool Fresh => pictures > 0 && DateTime.UtcNow - lastFrame < TimeSpan.FromSeconds(5);
    public Guid CameraId => camera.Id;
    public event Action<string>? SurfacePointer;
    public void HideChrome(){foreach(Control c in Controls)if(c is Label)c.Visible=false;Margin=Padding.Empty;}
    internal static string HardwareBackend="d3d11va";
    public string Quality {get;}
    string presentation="",cutoutKey="";
    public void SetPresentation(bool contain){var ratio=contain?"":$"{Math.Max(1,Width)}:{Math.Max(1,Height)}";if(presentation==ratio)return;presentation=ratio;player.AspectRatio=ratio.Length==0?null:ratio;}
    public void SetCutouts(Rectangle[] holes){var key=$"{Width}:{Height}:"+string.Join(";",holes.Select(r=>r.ToString()));if(key==cutoutKey)return;cutoutKey=key;var next=new Region(ClientRectangle);foreach(var hole in holes)next.Exclude(hole);var old=Region;Region=next;old?.Dispose();}
    public NativeVideoTile(LibVLC engine, Camera camera,string quality="principal")
    {
        this.engine = engine; this.camera = camera; Quality=quality;
        player = new MediaPlayer(engine) { Mute = true, EnableHardwareDecoding = true };
        player.EnableMouseInput=false;player.EnableKeyInput=false;
        player.EncounteredError += (_, _) => failed = true;
        view = new VideoView { Dock = DockStyle.Fill, MediaPlayer = player, BackColor = Color.Black };
        view.Click+=(_,_)=>SurfacePointer?.Invoke("click");view.DoubleClick+=(_,_)=>SurfacePointer?.Invoke("dblclick");
        view.MouseDown+=(_,e)=>{if(e.Button==MouseButtons.Right)SurfacePointer?.Invoke("contextmenu");};
        Controls.Add(view); Controls.Add(status);
        Controls.Add(new Label { Text = camera.Name, Dock = DockStyle.Top, Height = 24, ForeColor = Color.White });
        Margin = new Padding(2); BackColor = Color.FromArgb(30, 35, 41);
    }
    internal static Camera ForRoute(Camera original, int index)
    {
        var c = JsonSerializer.Deserialize<Camera>(JsonSerializer.Serialize(original))!;
        if (c.ConnectionRoutes.Count == 0) return c;
        var r = c.ConnectionRoutes[index % c.ConnectionRoutes.Count]; c.ConnectionRoutes = [];
        var source = new UriBuilder(c.Source) { Port = r.RtspPort };
        if (r.Kind == "cloud") { c.DeviceConnector = "IntelbrasCloud"; c.DeviceAddress = "ibcloud://" + r.Host; source.Host = "127.0.0.1"; }
        else { c.DeviceConnector = ""; source.Host = r.Host; }
        c.Source = source.Uri.AbsoluteUri; return c;
    }
    public async void Start()
    {
        if (disposed || retiring || connecting) return;
        HasStarted=true;
        connecting = true; failed = false; attempt = DateTime.UtcNow; status.Text = "Conectando…";
        try
        {
            // Stop can wait on network teardown. Keep it off the UI thread.
            stopTask = Task.Run(() => player.Stop()); await stopTask;
            if (disposed || retiring) return;
            media?.Dispose(); media = null; pictures = 0; lastFrame = default;
            var c = ForRoute(camera, route);
            // Exact path/subtype mapping emitted by DahuaHttpClient discovery.
            if(Quality=="extra"&&Uri.TryCreate(c.Source,UriKind.Absolute,out var stream)&&stream.AbsolutePath=="/cam/realmonitor"){
                var u=new UriBuilder(stream);u.Query=System.Text.RegularExpressions.Regex.Replace(u.Query.TrimStart('?'),@"(^|&)subtype=0(?=&|$)","$1subtype=1");c.Source=u.Uri.AbsoluteUri;
            }
            using var preparation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            preparation.CancelAfter(TimeSpan.FromSeconds(camera.ConnectionRoutes.Count > 1 ? 20 : 75));
            var source = await IntelbrasCloudTransport.Prepare(c, preparation.Token);
            if(disposed||retiring)return;
            media = new Media(engine, source, FromType.FromLocation);
            // Live monitoring: keep a small network buffer and do not grow the
            // presentation delay after a transient network jitter event.
            media.AddOption(":network-caching=100"); media.AddOption(":rtsp-tcp");
            media.AddOption(":clock-jitter=0");
            media.AddOption(":drop-late-frames");
            media.AddOption(":avcodec-threads=2");
            media.AddOption(":avcodec-hw="+HardwareBackend);
            media.AddOption(":no-audio");
            media.AddOption(":no-spu");
            if (c.User.Length > 0) { media.AddOption(":rtsp-user=" + c.User); media.AddOption(":rtsp-pwd=" + c.Password); }
            player.Play(media);
        }
        catch { failed = true; if(!disposed) status.Text = "Falha ao abrir vídeo; nova tentativa automática."; }
        finally { connecting = false; }
    }
    public void Check()
    {
        if (disposed || retiring || connecting || !HasStarted) return;
        var count = media?.Statistics.DisplayedPictures ?? 0;
        if (count > pictures) { pictures = count; lastFrame = DateTime.UtcNow; if (firstFrameMs < 0) firstFrameMs = elapsed.ElapsedMilliseconds; }
        if (Fresh) status.Text = "Ao vivo · decodificação nativa";
        else if (pictures > 0) status.Text = "Imagem sem atualização · reconectando…";
        var timeout = pictures > 0 ? lastFrame : attempt;
        var seconds = pictures > 0 ? 10 : (camera.ConnectionRoutes.ElementAtOrDefault(route)?.Kind == "cloud" || camera.DeviceConnector == "IntelbrasCloud" ? 85 : 15);
        if ((failed && DateTime.UtcNow-attempt>TimeSpan.FromSeconds(5)) || DateTime.UtcNow - timeout > TimeSpan.FromSeconds(seconds)) { route = (route + 1) % Math.Max(1, camera.ConnectionRoutes.Count); retries++; Start(); }
    }
    string Resolution(){uint w=0,h=0;player.Size(0,ref w,ref h);return $"{w}x{h}"; }
    public object Diagnostics() => new { camera.Id, quality=Quality, resolution=Resolution(), firstFrameMs, displayedPictures = pictures, fresh = Fresh, retries, connecting, route=camera.ConnectionRoutes.ElementAtOrDefault(route)?.Kind ?? camera.DeviceConnector, state=player.State.ToString(), decoded=media?.Statistics.DecodedVideo ?? 0 };
    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed) { disposed = true; lifetime.Cancel(); stopTask.GetAwaiter().GetResult(); retirement.GetAwaiter().GetResult(); view.MediaPlayer = null; player.Stop(); player.Dispose(); media?.Dispose(); lifetime.Dispose(); }
        base.Dispose(disposing);
    }
}


