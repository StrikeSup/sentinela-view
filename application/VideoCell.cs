using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;

namespace IndependentCenter;
public sealed class VideoCell : UserControl
{
    readonly VideoView video;
    readonly PictureBox empty = new() { Dock = DockStyle.Fill, Image = UiAssets.Get("logodguardcenter"), SizeMode = PictureBoxSizeMode.StretchImage, BackColor = CenterTheme.Surface };
    readonly Label caption = new() { Dock = DockStyle.Top, Height = 18, ForeColor = Color.White, BackColor = Color.FromArgb(42, 42, 42), Text = "Sem câmera", Padding = new Padding(5) };
    readonly Label status = new() { Dock = DockStyle.Bottom, Height = 16, ForeColor = Color.Silver, BackColor = Color.FromArgb(42, 42, 42), Text = "Desconectado" };
    public MediaPlayer Player { get; }
    public Camera? Camera { get; private set; }
    public bool Wanted { get; private set; }
    public DateTime LastAttempt { get; private set; }
    public event Action<VideoCell>? Selected;
    public event Action<VideoCell>? Maximized;
    public VideoCell(LibVLC engine)
    {
        BackColor = CenterTheme.Surface; Padding = new Padding(1); Margin = Padding.Empty;
        Player = new MediaPlayer(engine) { Mute = true }; video = new VideoView { Dock = DockStyle.Fill, MediaPlayer = Player, BackColor = Color.Black };
        Controls.Add(video); Controls.Add(empty); Controls.Add(caption); Controls.Add(status);
        empty.BringToFront(); caption.Visible = status.Visible = false; video.Visible = false;
        caption.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left && Camera is not null) caption.DoDragDrop(this, DragDropEffects.Move); };
        foreach (var c in new Control[] { this, video, caption, status, empty }) { c.Click += (_, _) => Selected?.Invoke(this); c.DoubleClick += (_, _) => Maximized?.Invoke(this); }
        Player.Playing += (_, _) => UpdateStatus("Ao vivo / reproduzindo");
        Player.Paused += (_, _) => UpdateStatus("Pausado");
        Player.EncounteredError += (_, _) => UpdateStatus("Falha de conexão");
        Player.EndReached += (_, _) => UpdateStatus("Fim da reprodução");
    }
    void UpdateStatus(string text) { if (IsHandleCreated && !IsDisposed) try { BeginInvoke(() => status.Text = text); } catch (InvalidOperationException) { } }
    public void Assign(Camera? camera)
    {
        Stop(); Camera = camera; caption.Text = camera?.Name ?? "Sem câmera";
        caption.Visible = status.Visible = video.Visible = camera is not null;
        empty.Visible = camera is null;
    }
    public void Play(LibVLC engine)
    {
        if (Camera is null) return;
        Wanted = true; LastAttempt = DateTime.UtcNow;
        using var media = new Media(engine, IntelbrasCloudTransport.Resolve(Camera), File.Exists(Camera.Source) ? FromType.FromPath : FromType.FromLocation);
        media.AddOption(":network-caching=500"); media.AddOption(":rtsp-tcp");
        if (File.Exists(Camera.Source)) media.AddOption(":input-repeat=-1");
        if (Camera.User.Length > 0) { media.AddOption(":rtsp-user=" + Camera.User); media.AddOption(":rtsp-pwd=" + Camera.Password); media.AddOption(":http-user=" + Camera.User); media.AddOption(":http-pwd=" + Camera.Password); }
        status.Text = "Conectando…"; Player.Play(media);
    }
    public bool Stop() { var active = Wanted || Player.IsPlaying; Wanted = false; Player.Stop(); status.Text = "Desconectado"; return active; }
    public void Highlight(bool selected) => BackColor = selected ? Color.FromArgb(65, 115, 140) : CenterTheme.Surface;
    public void RecordingIndicator(bool active) { caption.Text = (active ? "● REC  " : "") + (Camera?.Name ?? "Sem câmera"); caption.ForeColor = active ? Color.Salmon : Color.White; }
    protected override void Dispose(bool disposing) { if (disposing) { Wanted = false; Player.Stop(); video.MediaPlayer = null; Player.Dispose(); } base.Dispose(disposing); }
}

