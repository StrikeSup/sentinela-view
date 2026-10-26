using LibVLCSharp.Shared;

namespace IndependentCenter;
public sealed class MonitorWindow : StyledWindow
{
    readonly LibVLC engine; readonly Store store;
    readonly TableLayoutPanel grid = new() { Dock = DockStyle.Fill, BackColor = CenterTheme.Surface };
    readonly List<VideoCell> cells = [];
    readonly ConnectionQueue queue = new();
    readonly RecordingService recordings;
    readonly AutomaticRecording automaticRecording;
    readonly Account account;
    readonly System.Windows.Forms.Timer tick = new() { Interval = 250 };
    public VideoCell? SelectedCell { get; private set; }
    public IReadOnlyList<VideoCell> Cells => cells;
    public MonitorWindow(Store store, LibVLC engine, Account account)
    {
        this.store = store; this.engine = engine; this.account = account; recordings = new(store, engine); Text = "Monitor 1: Todas as c\u00e2meras"; MinimumSize = new Size(640, 400); Size = new Size(1000, 720); StartPosition = FormStartPosition.Manual; Location = new Point(20, 40);
        var bar = new FlowLayoutPanel { Dock = DockStyle.Left, Width = 61, WrapContents = false, AutoScroll = true, FlowDirection = FlowDirection.TopDown, BackColor = CenterTheme.Surface, Padding = new Padding(2) };
        ContentPanel.Controls.Add(grid); ContentPanel.Controls.Add(bar);
        foreach (int n in new[] { 1, 4, 6, 8, 9, 13, 16, 25, 64, 100 }) { var b = new LayoutButton(n); b.Click += (_, _) => SetGrid(n); bar.Controls.Add(b); }
        void Tool(Panel panel, string asset, string label, int left, Action action)
        {
            var button = new Button { Left = left, Top = 0, Width = 27, Height = 26, Image = UiAssets.Get(asset), AccessibleName = label, FlatStyle = FlatStyle.Flat, BackColor = CenterTheme.Surface, Margin = Padding.Empty };
            button.FlatAppearance.BorderSize = 0; button.Click += (_, _) => action(); panel.Controls.Add(button);
        }
        var firstTools = new Panel { Width = 57, Height = 26, Margin = Padding.Empty };
        Tool(firstTools, "fmmonitorbxmodopoupup", "Ampliar c?mera selecionada", 0, () => { if (SelectedCell is {} c) MaximizeCell(c); });
        Tool(firstTools, "fmmonitorbxmodotelacheia", "Tela cheia", 29, () => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized);
        bar.Controls.Add(firstTools);
        var secondTools = new Panel { Width = 57, Height = 26, Margin = Padding.Empty };
        Tool(secondTools, "fmmonitorbxmodorodizioauto", "Pr?xima c?mera", 0, () => { if (SelectedCell is {} c) Select(cells[(cells.IndexOf(c) + 1) % cells.Count]); });
        Tool(secondTools, "fmmonitorbxmodoproxcameras", "Reconectar layout", 29, () => { foreach (var c in cells) if (c.Camera is {} camera) queue.Enqueue(camera.Id, true); });
        bar.Controls.Add(secondTools);
        var recordButton = new Button { Width = 57, Height = 34, Image = UiAssets.Get("fmmonitorbxgravacao"), FlatStyle = FlatStyle.Flat, Margin = Padding.Empty, Enabled = account.CanOperate, AccessibleName = "Grava??o emergencial do layout" };
        recordButton.FlatAppearance.BorderSize = 0;
        recordButton.Click += (_, _) => { if (SelectedCell is {} c) Record(c, true, TimeSpan.FromMinutes(5)); };
        bar.Controls.Add(recordButton);
        automaticRecording = new(store, engine, recordings.IsRecording);
        SetGrid(16); tick.Tick += (_, _) => { queue.Tick(id => { foreach (var c in cells.Where(x => x.Camera?.Id == id)) c.Play(engine); }, id => { bool active = false; foreach (var c in cells.Where(x => x.Camera?.Id == id)) active |= c.Stop(); return active; }); foreach (var c in cells.Where(c => c.Wanted && !c.Player.IsPlaying && c.Player.State != VLCState.Paused && c.Player.State != VLCState.Opening && !File.Exists(c.Camera?.Source) && DateTime.UtcNow - c.LastAttempt > TimeSpan.FromSeconds(store.Data.ReconnectSeconds))) c.Play(engine); }; tick.Start();
        tick.Tick += (_, _) => { try { recordings.Tick(); automaticRecording.Tick(DateTimeOffset.Now); } catch (IOException e) { store.Log("Falha de armazenamento: " + e.GetType().Name); } foreach (var c in cells) c.RecordingIndicator(c.Camera is { } cam && IsRecording(cam.Id)); };
        Shown += (_, _) => recordings.Restore();
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
    }
    public void SetGrid(int count)
    {
        count = Math.Clamp(count, 1, 100);
        SuspendLayout(); grid.SuspendLayout();
        while (cells.Count > count) { var c = cells[^1]; cells.RemoveAt(cells.Count - 1); grid.Controls.Remove(c); c.Dispose(); }
        while (cells.Count < count)
        {
            var c = new VideoCell(engine) { Dock = DockStyle.Fill, AllowDrop = true }; c.Selected += Select; c.Maximized += MaximizeCell;
            c.DragEnter += (_, e) => { if (e.Data?.GetDataPresent(typeof(Camera)) == true || e.Data?.GetDataPresent(typeof(VideoCell)) == true) e.Effect = DragDropEffects.Move; };
            c.DragDrop += (_, e) => { if (e.Data?.GetData(typeof(Camera)) is Camera camera) { c.Assign(camera); queue.Enqueue(camera.Id, true); } else if (e.Data?.GetData(typeof(VideoCell)) is VideoCell other && other != c) { var a = other.Camera; var b = c.Camera; other.Assign(b); c.Assign(a); if (a is not null) queue.Enqueue(a.Id, true); if (b is not null) queue.Enqueue(b.Id, true); } Select(c); };
            var menu = new ContextMenuStrip(); menu.Items.Add("Conectar", null, (_, _) => c.Play(engine)); menu.Items.Add("Desconectar", null, (_, _) => c.Stop()); menu.Items.Add("Snapshot", null, (_, _) => { Select(c); Snapshot(); });
            var aspect = new ToolStripMenuItem("Taxa de proporção"); foreach (var ratio in new[] { "Original", "4:3", "16:10", "16:9", "5:4", "11:9" }) aspect.DropDownItems.Add(ratio, null, (_, _) => c.Player.AspectRatio = ratio == "Original" ? null : ratio); menu.Items.Add(aspect);
            var record = new ToolStripMenuItem("Habilitar gravação emergencial") { Enabled = account.CanOperate };
            record.DropDownItems.Add("Desta câmera — 5 minutos", null, (_, _) => Record(c, false, TimeSpan.FromMinutes(5)));
            record.DropDownItems.Add("Desta câmera — contínua", null, (_, _) => Record(c, false, null));
            record.DropDownItems.Add("Das câmeras deste layout — 5 minutos", null, (_, _) => Record(c, true, TimeSpan.FromMinutes(5))); menu.Items.Add(record);
            menu.Items.Add("Parar gravação emergencial desta câmera", null, (_, _) => { if (account.CanOperate && c.Camera is { } cam) recordings.Stop(cam.Id); }).Enabled = account.CanOperate;
            menu.Items.Add("Remover câmera", null, (_, _) => c.Assign(null)); c.ContextMenuStrip = menu; cells.Add(c);
        }
        grid.Controls.Clear(); grid.ColumnStyles.Clear(); grid.RowStyles.Clear();
        var geometry = LayoutGeometry.Create(count); grid.ColumnCount = grid.RowCount = geometry.Side;
        for (int i = 0; i < geometry.Side; i++) { grid.ColumnStyles.Add(new(SizeType.Percent, 100f / geometry.Side)); grid.RowStyles.Add(new(SizeType.Percent, 100f / geometry.Side)); }
        for (int i = 0; i < cells.Count; i++) { var slot = geometry.Slots[i]; cells[i].Visible = true; grid.Controls.Add(cells[i], slot.X, slot.Y); grid.SetColumnSpan(cells[i], slot.Width); grid.SetRowSpan(cells[i], slot.Height); }
        if (SelectedCell is null || !cells.Contains(SelectedCell)) Select(cells[0]); grid.ResumeLayout(); ResumeLayout();
    }
    void Select(VideoCell c) { SelectedCell = c; foreach (var cell in cells) { cell.Highlight(cell == c); cell.Player.Mute = cell != c; } }
    void MaximizeCell(VideoCell c) { if (cells.Count(x => x.Visible) == 1) { SetGrid(cells.Count); return; } foreach (var x in cells) x.Visible = x == c; grid.SetCellPosition(c, new(0, 0)); grid.SetColumnSpan(c, grid.ColumnCount); grid.SetRowSpan(c, grid.RowCount); Select(c); }
    public void AddCamera(Camera camera) { var cell = cells.FirstOrDefault(x => x.Camera is null) ?? SelectedCell!; cell.Assign(camera); Select(cell); queue.Enqueue(camera.Id, true); if (!Visible) Show(); }
    public void Connect(Guid id, bool start) => queue.Enqueue(id, start);
    public void ApplyLayout(SavedLayout layout, bool connectAll = true) { SetGrid(layout.Cells); for (int i = 0; i < cells.Count; i++) { cells[i].Assign(i < layout.Cameras.Count ? store.Data.Cameras.FirstOrDefault(c => c.Id == layout.Cameras[i]) : null); if (cells[i].Camera is { } c && (connectAll || c.AutoConnect)) queue.Enqueue(c.Id, true); } }
    public SavedLayout CaptureLayout(string name) => new() { Name = name, Cells = cells.Count, Cameras = cells.Select(c => c.Camera?.Id).ToList() };
    public void Snapshot() { if (SelectedCell is not { } c || !c.Player.IsPlaying) return; var folder = Path.Combine(store.Root, "snapshots"); Directory.CreateDirectory(folder); var path = Path.Combine(folder, $"{c.Camera?.Id}_{DateTime.Now:yyyyMMdd_HHmmss_fff}.png"); if (c.Player.TakeSnapshot(0, path, 0, 0)) { store.Log("Snapshot salvo " + Path.GetFileName(path)); MessageBox.Show(this, path, "Snapshot salvo"); } else MessageBox.Show(this, "Não foi possível salvar a imagem."); }
    public void StopRecording(Guid id) { recordings.Stop(id); automaticRecording.Suspend(id); }
    public bool IsRecording(Guid id) => recordings.IsRecording(id) || automaticRecording.IsRecording(id);
    void Record(VideoCell cell, bool all, TimeSpan? duration) { if (!account.CanOperate) return; try { foreach (var c in (all ? cells : new List<VideoCell> { cell }).Where(c => c.Camera is not null).Select(c => c.Camera!).DistinctBy(c => c.Id)) { automaticRecording.Suspend(c.Id); recordings.Start(c, duration); } } catch (Exception e) { MessageBox.Show(this, e.Message, "Gravação"); } }
    protected override void Dispose(bool disposing) { if (disposing) { tick.Dispose(); automaticRecording.Dispose(); recordings.Dispose(); foreach (var c in cells) c.Dispose(); } base.Dispose(disposing); }
}
