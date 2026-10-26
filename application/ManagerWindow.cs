using LibVLCSharp.Shared;

namespace IndependentCenter;
public sealed class ManagerWindow : StyledWindow
{
    readonly Store store;
    readonly LibVLC engine;
    readonly MonitorWindow monitor;
    readonly TreeView servers = new() { Dock = DockStyle.Fill, HideSelection = false, BorderStyle = BorderStyle.None };
    readonly ListBox layouts = new() { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None };
    readonly TextBox filter = new() { Dock = DockStyle.Fill, PlaceholderText = "Pesquisar servidores" };
    readonly System.Windows.Forms.Timer patrol = new() { Interval = 250 };
    readonly System.Windows.Forms.Timer clock = new() { Interval = 1000 };
    readonly ToolTip tips = new();
    readonly List<IDisposable> ownedResources = [];
    bool resourcesDisposed;
    CenterWebServer? webServer;
    PatrolRunner? patrolRunner;
    readonly ComboBox patrols = new() { Dock = DockStyle.Top, DropDownStyle = ComboBoxStyle.DropDownList };

    public ManagerWindow(Store store, LibVLC engine, bool demo, Account account)
    {
        this.store = store; this.engine = engine;
        monitor = new(store, engine, account);
        Text = "Gerenciador"; Font = new Font("Tahoma", 8.25f);
        MinimumSize = new Size(300, 520); Size = new Size(320, 760);
        StartPosition = FormStartPosition.Manual;

        var header = new Panel { Dock = DockStyle.Top, Height = 26, Padding = new Padding(8, 3, 8, 3) };
        var userLabel = new Label { Text = account.Name, Dock = DockStyle.Left, Width = 95, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
        var timeLabel = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight };
        header.Controls.Add(timeLabel); header.Controls.Add(userLabel);
        var host = new Panel { Dock = DockStyle.Fill, Padding = new Padding(7) };
        var nav = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 78, ColumnCount = 4, RowCount = 1, Padding = new Padding(3, 4, 3, 2) };
        for (int i = 0; i < 4; i++) nav.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        ContentPanel.Controls.Add(host); ContentPanel.Controls.Add(nav); ContentPanel.Controls.Add(header);

        var home = new Panel { Dock = DockStyle.Fill };
        var manager = new Panel { Dock = DockStyle.Fill };
        var config = new Panel { Dock = DockStyle.Fill };
        var applications = new Panel { Dock = DockStyle.Fill };
        var pages = new[] { home, manager, config, applications };
        var names = new[] { "Home", "Gerenciador", "Configurações", "Aplicativos" };
        var assets = new[] { "fmgerenciadorbthome", "fmgerenciadorbtgerenciador", "fmgerenciadorbtconfiguracoes", "fmgerenciadorbtaplicativos" };
        var navigation = new List<Button>();
        void ShowPage(int index)
        {
            for (int i = 0; i < pages.Length; i++) { pages[i].Visible = i == index; navigation[i].BackColor = i == index ? CenterTheme.Surface : CenterTheme.Panel; }
            pages[index].BringToFront();
        }
        for (int i = 0; i < pages.Length; i++)
        {
            host.Controls.Add(pages[i]); int index = i;
            var button = new Button { Dock = DockStyle.Fill, Text = names[i], Image = UiAssets.Get(assets[i]), ImageAlign = ContentAlignment.TopCenter, TextAlign = ContentAlignment.BottomCenter, TextImageRelation = TextImageRelation.ImageAboveText, FlatStyle = FlatStyle.Flat, Margin = Padding.Empty, Font = new Font("Tahoma", 7f), Padding = new Padding(0, 2, 0, 2) };
            button.FlatAppearance.BorderSize = 0; button.Click += (_, _) => ShowPage(index);
            if (i == 2) button.Enabled = account.CanConfigure;
            navigation.Add(button); nav.Controls.Add(button, i, 0);
        }

        FlowLayoutPanel Stack(Panel page)
        {
            var stack = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = Padding.Empty };
            page.Controls.Add(stack);
            stack.ClientSizeChanged += (_, _) => { foreach (Control child in stack.Controls) child.Width = Math.Max(100, stack.ClientSize.Width - SystemInformation.VerticalScrollBarWidth - 4); };
            return stack;
        }
        Panel Card(FlowLayoutPanel stack, string title, int height)
        {
            var card = new Panel { Width = 278, Height = height, Margin = new Padding(0, 0, 0, 8), Padding = new Padding(9) };
            var heading = new Label { Text = title, Dock = DockStyle.Top, Height = 23, TextAlign = ContentAlignment.MiddleLeft };
            var body = new Panel { Dock = DockStyle.Fill };
            card.Controls.Add(body); card.Controls.Add(heading); stack.Controls.Add(card);
            return body;
        }
        void Add(FlowLayoutPanel stack, string text, Action action)
        {
            var button = new Button { Text = text, Width = 278, Height = 32, Margin = new Padding(0, 0, 0, 5), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0) };
            button.Click += (_, _) => { try { action(); } catch (Exception e) { MessageBox.Show(this, e.Message, "Center", MessageBoxButtons.OK, MessageBoxIcon.Error); } };
            stack.Controls.Add(button);
        }
        var homeStack = Stack(home);
        var monitorStatus = Card(homeStack, "MONITOR 1", 58);
        var monitorName = new Label { Text = "Todas as câmeras", Dock = DockStyle.Fill, AutoEllipsis = true };
        monitorStatus.Controls.Add(monitorName);
        var ptzCard = Card(homeStack, "CONTROLE | PTZ", 385);
        var ptz = new PtzPanel(() => monitor.SelectedCell?.Camera, account.CanOperate) { Location = new Point(0, 0) };
        ptzCard.Controls.Add(ptz);
        var ptzBounds = ptz.Controls.Cast<Control>().ToDictionary(c => c, c => c.Bounds);
        int lastPtzWidth = -1;
        bool fittingPtz = false;
        void FitPtz()
        {
            int width = ptzCard.ClientSize.Width;
            if (fittingPtz || width <= 0 || width == lastPtzWidth) return;
            fittingPtz = true;
            try
            {
                lastPtzWidth = width;
                float ratio = width / 280f;
                ptz.SuspendLayout();
                ptz.Bounds = new Rectangle(0, 0, width, (int)Math.Ceiling(344 * ratio));
                foreach (var pair in ptzBounds)
                {
                    var b = pair.Value;
                    pair.Key.Bounds = new Rectangle((int)Math.Round(b.X * ratio), (int)Math.Round(b.Y * ratio), Math.Max(1, (int)Math.Round(b.Width * ratio)), Math.Max(1, (int)Math.Round(b.Height * ratio)));
                }
                ptz.ResumeLayout();
                if (ptzCard.Parent is Panel card)
                {
                    int titleHeight = card.Controls.OfType<Label>().Sum(c => c.Height);
                    card.Height = ptz.Height + card.Padding.Vertical + titleHeight;
                }
            }
            finally { fittingPtz = false; }
        }
        ptzCard.ClientSizeChanged += (_, _) => FitPtz();
        FitPtz();
        var audio = Card(homeStack, "ÁUDIO", 139);
        var talk = new ComboBox { Dock = DockStyle.Top, Enabled = false, Text = "Falar — indisponível", Height = 22 };
        tips.SetToolTip(talk, "Transmissão de áudio ainda não implementada.");
        var listen = new CheckBox { Text = "Escutar câmera selecionada", Checked = true, Dock = DockStyle.Top, Height = 24 };
        var volume = new TrackBar { Dock = DockStyle.Bottom, Height = 34, Minimum = 0, Maximum = 100, Value = 100, TickStyle = TickStyle.None };
        audio.Controls.Add(talk); audio.Controls.Add(listen); audio.Controls.Add(volume);
        listen.CheckedChanged += (_, _) => { if (monitor.SelectedCell is { } cell) cell.Player.Mute = !listen.Checked; };
        volume.ValueChanged += (_, _) => { if (monitor.SelectedCell is { } cell) cell.Player.Volume = volume.Value; };
        var windowCard = Card(homeStack, "JANELAS EM EXECUÇÃO", 130);
        var windows = new ListBox { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None };
        windowCard.Controls.Add(windows);
        windows.DoubleClick += (_, _) => { if (windows.SelectedItem is Form f && !f.IsDisposed) { f.Show(); f.Activate(); } };
        windows.DisplayMember = "Text";
        var layoutCard = Card(homeStack, "LAYOUTS", 215); layoutCard.Controls.Add(layouts);
        var layoutMenu = new ContextMenuStrip();
        ownedResources.Add(layoutMenu);
        layoutMenu.Items.Add("Abrir layout", null, (_, _) => { if (layouts.SelectedItem is SavedLayout l) monitor.ApplyLayout(l); });
        layoutMenu.Items.Add("Salvar layout atual…", null, (_, _) => SaveLayout());
        layoutMenu.Items.Add("Excluir layout selecionado", null, (_, _) => { if (layouts.SelectedItem is SavedLayout l) { store.Data.Layouts.Remove(l); store.Save(); RefreshLayouts(); } });
        layouts.ContextMenuStrip = layoutMenu;
        layouts.DoubleClick += (_, _) => { if (layouts.SelectedItem is SavedLayout l) monitor.ApplyLayout(l); };
        var patrolCard = Card(homeStack, "RONDAS VIRTUAIS", 101); patrolCard.Controls.Add(patrols);
        var patrolButton = new Button { Text = "Iniciar ronda virtual", Dock = DockStyle.Bottom, Height = 28 }; patrolCard.Controls.Add(patrolButton);
        RefreshPatrols();
        void StopPatrol() { patrol.Stop(); patrolRunner = null; patrolButton.Text = "Iniciar ronda virtual"; }
        void OpenPatrolLayout(Guid id) { var layout = store.Data.Layouts.FirstOrDefault(l => l.Id == id); if (layout is null) { StopPatrol(); return; } monitor.ApplyLayout(layout); }
        patrolButton.Click += (_, _) => { if (patrol.Enabled) { StopPatrol(); return; } if (patrols.SelectedItem is not PatrolPlan plan || plan.Steps.Count == 0) { MessageBox.Show(this, "Cadastre uma ronda em Configurações."); return; } patrolRunner = new(plan, DateTimeOffset.UtcNow); patrol.Start(); patrolButton.Text = "Parar ronda virtual"; OpenPatrolLayout(patrolRunner.Current); };
        patrol.Tick += (_, _) => { if (patrolRunner?.Advance(DateTimeOffset.UtcNow) is { } id) OpenPatrolLayout(id); };
        var webCard = Card(homeStack, "PÁGINAS WEB", 90);
        var openWeb = new Button { Text = "Abrir Center Web", Dock = DockStyle.Fill };
        webCard.Controls.Add(openWeb);
        openWeb.Click += async (_, _) =>
        {
            openWeb.Enabled = false;
            try
            {
                if (store.Data.Accounts.Count == 0) { MessageBox.Show(this, "Cadastre um usuário em Configurações > Usuários para acessar a página web."); return; }
                if (webServer is null)
                {
                    var candidate = new CenterWebServer(engine, WebCatalogSnapshot);
                    try { await candidate.StartAsync(); webServer = candidate; }
                    catch { candidate.Dispose(); throw; }
                }
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(webServer.Address) { UseShellExecute = true });
            }
            catch (Exception e) { MessageBox.Show(this, "Não foi possível abrir o serviço web: " + e.Message); }
            finally { if (!IsDisposed) openWeb.Enabled = true; }
        };

        var treeHeader = new TableLayoutPanel { Dock = DockStyle.Top, Height = 29, ColumnCount = 2, RowCount = 1 };
        treeHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 85)); treeHeader.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        treeHeader.Controls.Add(new Label { Text = "SERVIDORES", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0); treeHeader.Controls.Add(filter, 1, 0);
        manager.Controls.Add(servers); manager.Controls.Add(treeHeader);
        var serverMenu = new ContextMenuStrip();
        ownedResources.Add(serverMenu);
        foreach (var entry in new (string Label, Action Action, bool Configure)[] {
            ("Novo servidor / câmera…", () => Edit(null), true),
            ("Editar…", () => { if (SelectedCamera() is { } c) Edit(c); }, true),
            ("Excluir", Delete, true),
            ("Conectar", () => { foreach (var c in SelectedProfiles()) monitor.AddCamera(c); }, false),
            ("Desconectar", () => { foreach (var c in SelectedProfiles()) monitor.Connect(c.Id, false); }, false) })
        { var item = serverMenu.Items.Add(entry.Label, null, (_, _) => entry.Action()); item.Enabled = !entry.Configure || account.CanConfigure; }
        servers.ContextMenuStrip = serverMenu;
        tips.SetToolTip(servers, "Duplo clique para conectar. Botão direito para cadastrar, editar ou desconectar.");
        servers.NodeMouseClick += (_, e) => servers.SelectedNode = e.Node;
        servers.NodeMouseDoubleClick += (_, e) => { if (e.Node.Tag is Camera c) monitor.AddCamera(c); };
        filter.TextChanged += (_, _) => RefreshServers();
        servers.ItemDrag += (_, e) => { if (e.Item is TreeNode { Tag: Camera camera }) servers.DoDragDrop(camera, DragDropEffects.Move); };

        var settings = Stack(config);
        settings.Controls.Add(new Label { Text = "CONFIGURAÇÕES", Width = 278, Height = 28 });
        Add(settings, "Cadastrar servidor / câmera…", () => Edit(null));
        Add(settings, "Lista de servidores", () => new ServerListWindow(store, monitor, account, Edit, RefreshServers).Show(this));
        Add(settings, "Gravação e agenda semanal", () => new RecordingPlanWindow(store, account).ShowDialog(this));
        Add(settings, "Equipamentos e perfis", () => new EquipmentWindow(store, monitor, ImportEquipment, RefreshServers).Show(this));
        Add(settings, "Importar câmeras ONVIF", () => { using var dialog = new OnvifDialog(); if (dialog.ShowDialog(this) == DialogResult.OK) ImportEquipment(dialog.Cameras); });
        settings.Controls.Add(new Label { Text = "Reconexão (60 a 300 segundos)", Width = 278, Height = 24 });
        var reconnect = new NumericUpDown { Minimum = 60, Maximum = 300, Value = store.Data.ReconnectSeconds, Width = 278 }; settings.Controls.Add(reconnect);
        reconnect.ValueChanged += (_, _) => { store.Data.ReconnectSeconds = (int)reconnect.Value; store.Save(); };
        Add(settings, "Pasta de gravações…", () => { using var d = new FolderBrowserDialog { SelectedPath = store.Data.RecordingDirectory }; if (d.ShowDialog(this) == DialogResult.OK) { store.Data.RecordingDirectory = d.SelectedPath; store.Save(); } });
        Add(settings, "Relatório de eventos", () => { var path = Path.Combine(store.Root, "events.log"); if (!File.Exists(path)) File.WriteAllText(path, ""); System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe") { ArgumentList = { path }, UseShellExecute = false }); });
        Add(settings, "Usuários", () => new AccountsWindow(store, account).ShowDialog(this));
        Add(settings, "Parar serviço web local", () => { webServer?.Dispose(); webServer = null; });
        Add(settings, "Nova ronda virtual", () => { StopPatrol(); EditPatrol(null); });
        Add(settings, "Editar ronda selecionada", () => { StopPatrol(); if (patrols.SelectedItem is PatrolPlan plan) EditPatrol(plan); });
        Add(settings, "Excluir ronda selecionada", () => { StopPatrol(); if (patrols.SelectedItem is PatrolPlan plan && MessageBox.Show(this, "Excluir a ronda " + plan.Name + "?", "Rondas", MessageBoxButtons.YesNo) == DialogResult.Yes) { store.Data.Patrols.Remove(plan); store.Save(); RefreshPatrols(); } });
        config.Enabled = account.CanConfigure;
        var apps = Stack(applications);
        Add(apps, "Monitor ao vivo", () => { monitor.Show(); monitor.Activate(); });
        Add(apps, "Reprodução de arquivo", OpenPlayback);
        Add(apps, "Gravações locais", () => new RecordingsWindow(store, engine).Show(this));
        Add(apps, "Snapshot da câmera selecionada", monitor.Snapshot);

        if (demo && store.Data.Cameras.Count == 0) { var path = Path.Combine(AppContext.BaseDirectory, "demo.mp4"); if (File.Exists(path)) { store.Data.Cameras.Add(new() { Name = "Câmera de demonstração", Source = path, AutoConnect = true }); store.Save(); } }
        if (demo) { foreach (var camera in store.Data.Cameras.Where(c => c.Source == Path.Combine(AppContext.BaseDirectory, "demo.mp4"))) camera.Name = "Câmera de demonstração"; store.Save(); }
        RefreshServers(); RefreshLayouts();
        CenterTheme.Apply(ContentPanel);
        ShowPage(1);
        void ArrangeWindows()
        {
            var area = Screen.PrimaryScreen!.WorkingArea;
            int managerWidth = Math.Max((int)Math.Round(300 * DeviceDpi / 96f), (int)Math.Round(area.Width * .12));
            managerWidth = Math.Min(managerWidth, Math.Max(300, area.Width - 640));
            Bounds = new Rectangle(area.Right - managerWidth, area.Top, managerWidth, area.Height);
            monitor.Bounds = new Rectangle(area.Left, area.Top, Math.Max(640, area.Width - managerWidth), area.Height);
        }
        Shown += (_, _) => { ArrangeWindows(); monitor.Show(); if (store.Data.LastLayout is { } last) monitor.ApplyLayout(last, false); else { var active = store.Data.Cameras.Where(c => c.AutoConnect).ToList(); if (active.Count > 16) monitor.SetGrid(Math.Min(64, (int)Math.Pow(Math.Ceiling(Math.Sqrt(active.Count)), 2))); foreach (var c in active.Take(64)) monitor.AddCamera(c); } };
        DpiChanged += (_, _) => BeginInvoke(ArrangeWindows);
        clock.Tick += (_, _) => {
            timeLabel.Text = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");
            var currentWindows = Application.OpenForms.Cast<Form>().Where(f => f != this && f.Visible).ToArray();
            if (!windows.Items.Cast<Form>().SequenceEqual(currentWindows)) { windows.Items.Clear(); windows.Items.AddRange(currentWindows); }
            if (monitor.SelectedCell is { } cell) { cell.Player.Mute = !listen.Checked; cell.Player.Volume = volume.Value; }
        };
        timeLabel.Text = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"); clock.Start();
        FormClosing += (_, _) => store.Data.LastLayout = monitor.CaptureLayout("Última sessão");
        FormClosed += (_, _) => store.Save();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing && !resourcesDisposed)
        {
            resourcesDisposed = true;
            webServer?.Dispose(); webServer = null;
            clock.Dispose(); patrol.Dispose(); tips.Dispose();
            foreach (var resource in ownedResources) resource.Dispose();
            monitor?.Dispose();
        }
        base.Dispose(disposing);
    }
    Camera? SelectedCamera() => servers.SelectedNode?.Tag as Camera;
    IEnumerable<Camera> SelectedProfiles() => servers.SelectedNode?.Tag switch
    {
        Camera c => [c],
        Equipment e => store.Data.Cameras.Where(c => c.EquipmentId == e.Id).ToArray(),
        ValueTuple<Guid, string> channel => store.Data.Cameras.Where(c => c.EquipmentId == channel.Item1 && c.ChannelToken == channel.Item2).ToArray(),
        _ => []
    };
    Task<WebCatalog> WebCatalogSnapshot()
    {
        var completion = new TaskCompletionSource<WebCatalog>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (IsDisposed || Disposing) return Task.FromException<WebCatalog>(new ObjectDisposedException(nameof(ManagerWindow)));
        try
        {
            BeginInvoke(() =>
            {
                try
                {
                    var cameras = store.Data.Cameras.Select(c => new Camera { Id = c.Id, EquipmentId = c.EquipmentId, ChannelToken = c.ChannelToken, Name = c.Name, Group = c.Group, Source = c.Source, User = c.User, ProtectedPassword = c.ProtectedPassword, OnvifAddress = c.OnvifAddress }).ToArray();
                    var accounts = store.Data.Accounts.Select(a => new Account { Name = a.Name, Role = a.Role, Salt = a.Salt, Hash = a.Hash }).ToArray();
                    completion.TrySetResult(new(cameras, accounts));
                }
                catch (Exception e) { completion.TrySetException(e); }
            });
        }
        catch (InvalidOperationException e) { completion.TrySetException(e); }
        return completion.Task;
    }
    void RefreshServers()
    {
        servers.BeginUpdate(); servers.Nodes.Clear();
        foreach (var g in store.Data.Cameras.Where(c => (c.Name + " " + c.Group).Contains(filter.Text, StringComparison.CurrentCultureIgnoreCase)).GroupBy(c => c.EquipmentId?.ToString() ?? "group:" + c.Group))
        {
            var equipment = store.Data.Equipment.FirstOrDefault(e => e.Id == g.First().EquipmentId);
            var parent = servers.Nodes.Add(equipment?.Name ?? g.First().Group);
            parent.Tag = equipment;
            if (equipment is null) { foreach (var c in g) parent.Nodes.Add(new TreeNode(c.Name) { Tag = c }); continue; }
            foreach (var channel in g.GroupBy(c => c.ChannelToken))
            {
                var channelNode = parent.Nodes.Add(channel.Key.Length > 0 ? "Canal " + channel.Key : "Perfis sem identificação de canal");
                channelNode.Tag = (equipment.Id, channel.Key);
                foreach (var c in channel) channelNode.Nodes.Add(new TreeNode(c.Name) { Tag = c });
            }
        }
        servers.ExpandAll(); servers.EndUpdate();
    }
    void RefreshLayouts() { layouts.DataSource = null; layouts.DataSource = store.Data.Layouts.ToList(); }
    void RefreshPatrols(){patrols.DataSource=null;patrols.DataSource=store.Data.Patrols.ToList();}
    void EditPatrol(PatrolPlan? original){using var dialog=new PatrolDialog(store,original);if(dialog.ShowDialog(this)!=DialogResult.OK)return;store.Data.Patrols.RemoveAll(p=>p.Id==dialog.Result.Id);store.Data.Patrols.Add(dialog.Result);store.Save();RefreshPatrols();}
    void Edit(Camera? camera)
    {
        using var d = new CameraDialog(camera); if (d.ShowDialog(this) != DialogResult.OK) return;
        if (d.ImportedCameras.Count > 0)
        {
            ImportEquipment(d.ImportedCameras);
            return;
        }
        if (camera is not null) monitor.StopRecording(camera.Id);
        var i = store.Data.Cameras.FindIndex(c => c.Id == d.Result.Id);
        if (i < 0) store.Data.Cameras.Add(d.Result); else { store.Data.Cameras[i] = d.Result; foreach (var cell in monitor.Cells.Where(c => c.Camera?.Id == d.Result.Id)) cell.Assign(d.Result); }
        store.Save(); store.Log("Cadastro atualizado: " + d.Result.Id); RefreshServers(); if (d.Result.AutoConnect) monitor.AddCamera(d.Result);
    }
    void ImportEquipment(IReadOnlyList<Camera> discovered)
    {
        try
        {
            var updated = EquipmentCatalog.ImportProfiles(store, discovered);
            foreach (var camera in updated)
            {
                foreach (var cell in monitor.Cells.Where(c => c.Camera?.Id == camera.Id))
                {
                    bool reconnect = cell.Wanted;
                    if (cell.Camera?.Source != camera.Source) monitor.StopRecording(camera.Id);
                    cell.Assign(camera); if (reconnect) monitor.Connect(camera.Id, true);
                }
                if (camera.AutoConnect) monitor.AddCamera(camera);
            }
            RefreshServers();
        }
        catch (Exception e) { MessageBox.Show(this, e.Message, "Cadastro do equipamento"); }
    }
    void Delete() { if (SelectedCamera() is not { } c) return; if (MessageBox.Show(this, "Excluir " + c.Name + "?", "Excluir cadastro", MessageBoxButtons.YesNo) != DialogResult.Yes) return; foreach (var cell in monitor.Cells.Where(x => x.Camera?.Id == c.Id)) cell.Assign(null); monitor.StopRecording(c.Id); store.Data.Cameras.Remove(c); store.Save(); RefreshServers(); }
    void SaveLayout() { using var f = new Form { Text = "Salvar layout", ClientSize = new Size(350, 110), StartPosition = FormStartPosition.CenterParent }; var name = new TextBox { Left = 15, Top = 15, Width = 320 }; var save = new Button { Text = "Salvar", Left = 230, Top = 55, DialogResult = DialogResult.OK }; f.Controls.AddRange([name, save]); f.AcceptButton = save; f.FormBorderStyle = FormBorderStyle.FixedDialog; f.MaximizeBox = false; CenterTheme.Apply(f); if (f.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(name.Text)) { var captured=monitor.CaptureLayout(name.Text.Trim());var previous=store.Data.Layouts.FirstOrDefault(l=>l.Name==captured.Name);if(previous is not null)captured.Id=previous.Id;store.Data.Layouts.RemoveAll(l => l.Name == name.Text.Trim()); store.Data.Layouts.Add(captured); store.Save(); RefreshLayouts(); } }
    void OpenPlayback() { using var d = new OpenFileDialog { Filter = "Vídeos|*.mp4;*.mkv;*.avi;*.ts;*.mov|Todos|*.*" }; if (d.ShowDialog(this) == DialogResult.OK) new PlaybackWindow(engine, d.FileName).Show(this); }
}

