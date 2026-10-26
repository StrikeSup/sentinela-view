namespace IndependentCenter;

public class StyledWindow : Form
{
    public Panel ContentPanel { get; } = new() { Dock = DockStyle.Fill };
    readonly Panel titleBar = new() { Dock = DockStyle.Top, Height = 22 };
    readonly Label title = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(4, 0, 0, 0) };
    Point dragStart;
    public StyledWindow()
    {
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        Font = new Font("Tahoma", 8.25f);
        FormBorderStyle = FormBorderStyle.None;
        BackColor = CenterTheme.Surface; ForeColor = CenterTheme.Text;
        Padding = new Padding(1);
        titleBar.BackColor = CenterTheme.Surface; title.ForeColor = CenterTheme.Text;
        Controls.Add(ContentPanel); Controls.Add(titleBar);
        titleBar.Controls.Add(title);
        foreach (var spec in new[] { ("bxfmbasefechar", "Fechar", (Action)(() => Close())), ("bxfmbasemaximizar", "Restaurar / maximizar", (Action)(() => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized)), ("bxfmbaseminimizar", "Minimizar", (Action)(() => WindowState = FormWindowState.Minimized)) }.Reverse())
        {
            var b = new Button { Dock = DockStyle.Right, Width = 21, FlatStyle = FlatStyle.Flat, Image = UiAssets.Get(spec.Item1), AccessibleName = spec.Item2, TabStop = false };
            b.FlatAppearance.BorderSize = 0;
            b.Click += (_, _) => { if (spec.Item1.Contains("maximizar") && !MaximizeBox || spec.Item1.Contains("minimizar") && !MinimizeBox) return; spec.Item3(); };
            Shown += (_, _) => b.Visible = spec.Item1.Contains("maximizar") ? MaximizeBox : spec.Item1.Contains("minimizar") ? MinimizeBox : true;
            titleBar.Controls.Add(b); b.BringToFront();
        }
        TextChanged += (_, _) => title.Text = Text;
        title.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) dragStart = e.Location; };
        title.MouseMove += (_, e) => { if (e.Button == MouseButtons.Left && WindowState == FormWindowState.Normal) Location = new Point(Left + e.X - dragStart.X, Top + e.Y - dragStart.Y); };
        title.DoubleClick += (_, _) => { if (MaximizeBox) WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; };
    }
}

internal static class UiAssets
{
    static readonly Dictionary<string, Image?> cache = new(StringComparer.OrdinalIgnoreCase);
    public static Image? Get(string name)
    {
        if (cache.TryGetValue(name, out var found)) return found;
        var root = Path.Combine(AppContext.BaseDirectory, "Assets", "Dark");
        foreach (var ext in new[] { ".bmp", ".png", ".jpg" })
        {
            var path = Path.Combine(root, name.ToLowerInvariant() + ext);
            if (!File.Exists(path)) continue;
            using var source = Image.FromFile(path);
            var image = new Bitmap(source);
            if (ext == ".bmp") image.MakeTransparent(Color.Fuchsia);
            cache[name] = image; return image;
        }
        cache[name] = null; return null;
    }
}
