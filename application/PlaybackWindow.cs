using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;
namespace IndependentCenter;
public sealed class PlaybackWindow : Form
{
    readonly MediaPlayer player; readonly VideoView video;
    readonly TrackBar position = new() { Dock = DockStyle.Bottom, Maximum = 1000, TickStyle = TickStyle.None };
    readonly System.Windows.Forms.Timer timer = new() { Interval = 250 }; bool seeking;
    public PlaybackWindow(LibVLC engine, string path)
    {
        Text = "Player — " + Path.GetFileName(path); Size = new Size(900, 650); player = new(engine); video = new() { MediaPlayer = player, Dock = DockStyle.Fill }; Controls.Add(video); Controls.Add(position);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 45 }; Controls.Add(buttons);
        void Add(string label, Action action) { var b = new Button { Text = label, AutoSize = true }; b.Click += (_, _) => action(); buttons.Controls.Add(b); }
        Add("Reproduzir", () => player.Play()); Add("Pausar", () => player.SetPause(true)); Add("Parar", () => player.Stop());
        var speed = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 85 }; speed.Items.AddRange(["0,25×", "0,5×", "1×", "2×", "4×"]); speed.SelectedIndex = 2; speed.SelectedIndexChanged += (_, _) => player.SetRate(new float[] { .25f, .5f, 1, 2, 4 }[speed.SelectedIndex]); buttons.Controls.Add(speed);
        Add("Exportar arquivo", () => { using var d = new SaveFileDialog { FileName = Path.GetFileName(path), Filter = "Vídeo|*" + Path.GetExtension(path) }; if (d.ShowDialog(this) == DialogResult.OK) { try { File.Copy(path, d.FileName, true); } catch (Exception e) { MessageBox.Show(this, e.Message); } } });
        position.MouseDown += (_, _) => seeking = true; position.MouseUp += (_, _) => { if (player.IsSeekable) player.Position = position.Value / 1000f; seeking = false; }; timer.Tick += (_, _) => { if (!seeking) position.Value = Math.Clamp((int)(player.Position * 1000), 0, 1000); }; timer.Start();
        MinimumSize = new Size(600, 400);
        CenterTheme.Apply(this); video.BackColor = Color.Black;
        using var media = new Media(engine, path, FromType.FromPath); player.Play(media);
    }
    protected override void Dispose(bool disposing) { if (disposing) { timer.Dispose(); player.Stop(); video.MediaPlayer = null; player.Dispose(); } base.Dispose(disposing); }
}
public sealed class RecordingsWindow : Form
{
    public RecordingsWindow(Store store, LibVLC engine)
    {
        Text = "Gravações locais"; Size = new Size(700, 450); var list = new ListBox { Dock = DockStyle.Fill }; Controls.Add(list);
        foreach (var path in Directory.EnumerateFiles(store.Data.RecordingDirectory, "*", SearchOption.AllDirectories).Where(p => new[] { ".mp4", ".mkv", ".ts" }.Contains(Path.GetExtension(p).ToLowerInvariant()))) list.Items.Add(path);
        list.DoubleClick += (_, _) => { if (list.SelectedItem is string path) new PlaybackWindow(engine, path).Show(this); };
        MinimumSize = new Size(450, 300); CenterTheme.Apply(this);
    }
}
