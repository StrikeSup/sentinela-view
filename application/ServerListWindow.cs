using System.Text;
using System.Text.Json;

namespace IndependentCenter;

public sealed class ServerListWindow : StyledWindow
{
    readonly Store store;
    readonly MonitorWindow monitor;
    readonly Action<Camera?> edit;
    readonly Action refreshManager;
    readonly ListView rows = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = true, HideSelection = false, BorderStyle = BorderStyle.None };
    readonly TextBox search = new() { Width = 220, PlaceholderText = "Pesquisar servidores", MaxLength = 25 };
    readonly ComboBox filter = new() { Width = 150, DropDownStyle = ComboBoxStyle.DropDownList };
    readonly Label count = new() { Dock = DockStyle.Bottom, Height = 24, Padding = new Padding(6, 4, 0, 0) };
    readonly System.Windows.Forms.Timer refresh = new() { Interval = 1000 };
    readonly ContextMenuStrip menu = new();
    int sortColumn = 3;
    bool descending;
    string lastRows = "";
    public ServerListWindow(Store store, MonitorWindow monitor, Account account, Action<Camera?> edit, Action refreshManager)
    {
        this.store = store; this.monitor = monitor; this.edit = edit; this.refreshManager = refreshManager;
        Text = "Lista de servidores"; Size = new Size(1080, 450); MinimumSize = new Size(850, 350); StartPosition = FormStartPosition.CenterParent;
        var commands = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(6), WrapContents = false };
        ContentPanel.Controls.Add(rows); ContentPanel.Controls.Add(count); ContentPanel.Controls.Add(commands);
        void Button(string text, Action action, bool enabled = true)
        {
            var button = new Button { Text = text, Width = 85, Height = 26, Enabled = enabled }; button.Click += (_, _) => action(); commands.Controls.Add(button);
        }
        Button("Novo", () => { edit(null); RefreshRows(); }, account.CanConfigure);
        Button("Editar", EditSelected, account.CanConfigure);
        Button("Conectar", () => { foreach (var camera in Selected()) monitor.AddCamera(camera); });
        Button("Desconectar", () => { foreach (var camera in Selected()) monitor.Connect(camera.Id, false); });
        commands.Controls.Add(search); filter.Items.AddRange(["Todos", "Ativos", "Inativos", "Conectados"]); filter.SelectedIndex = 0; commands.Controls.Add(filter);
        foreach (var column in new[] { ("Conectado", 75), ("Conta", 70), ("Ativo", 55), ("Nome", 230), ("Modelo", 150), ("IP", 120), ("Porta", 65), ("Usuário", 80), ("Tipo", 110), ("Gravando", 75), ("Offline desde", 120), ("Firmware", 90) }) rows.Columns.Add(column.Item1, column.Item2);
        rows.ColumnClick += (_, e) => { descending = sortColumn == e.Column && !descending; sortColumn = e.Column; RefreshRows(); };
        rows.DoubleClick += (_, _) => { if (account.CanConfigure) EditSelected(); };
        search.TextChanged += (_, _) => RefreshRows(); filter.SelectedIndexChanged += (_, _) => RefreshRows();
        menu.Items.Add("Editar", null, (_, _) => EditSelected()).Enabled = account.CanConfigure;
        menu.Items.Add("Abrir no monitor", null, (_, _) => { foreach (var camera in Selected()) monitor.AddCamera(camera); });
        menu.Items.Add("Ativar selecionados", null, (_, _) => SetActive(Selected(), true)).Enabled = account.CanConfigure;
        menu.Items.Add("Desativar selecionados", null, (_, _) => SetActive(Selected(), false)).Enabled = account.CanConfigure;
        menu.Items.Add("Ativar todos os servidores", null, (_, _) => SetActive(store.Data.Cameras, true)).Enabled = account.CanConfigure;
        menu.Items.Add("Desativar todos os servidores", null, (_, _) => SetActive(store.Data.Cameras, false)).Enabled = account.CanConfigure;
        foreach (bool selected in new[] { false, true })
        {
            var parent = new ToolStripMenuItem(selected ? "Exportar selecionados para" : "Exportar todos para");
            foreach (var format in new[] { "CSV", "JSON" }) { var item = format; parent.DropDownItems.Add(item, null, (_, _) => Export(selected, item)); }
            menu.Items.Add(parent);
        }
        rows.ContextMenuStrip = menu;
        CenterTheme.Apply(ContentPanel); rows.BackColor = CenterTheme.Input; rows.ForeColor = CenterTheme.Text;
        RefreshRows(); refresh.Tick += (_, _) => RefreshRows(); refresh.Start();
    }
    List<Camera> Selected() => rows.SelectedItems.Cast<ListViewItem>().Select(item => (Camera)item.Tag!).ToList();
    void EditSelected() { var camera = Selected().FirstOrDefault(); if (camera is null) return; edit(camera); RefreshRows(); }
    bool Connected(Camera camera) => monitor.Cells.Any(cell => cell.Camera?.Id == camera.Id && cell.Player.IsPlaying);
    void SetActive(IEnumerable<Camera> cameras, bool active)
    {
        foreach (var camera in cameras.ToArray()) { camera.AutoConnect = active; if (!active) monitor.Connect(camera.Id, false); }
        store.Save(); refreshManager(); RefreshRows();
    }
    void RefreshRows()
    {
        var selected = Selected().Select(c => c.Id).ToHashSet(); var top = rows.TopItem?.Index ?? 0;
        var data = store.Data.Cameras.Where(c => (c.Name + " " + c.Group + " " + ServerCatalog.Endpoint(c).Host).Contains(search.Text, StringComparison.CurrentCultureIgnoreCase))
            .Where(c => filter.SelectedIndex switch { 1 => c.AutoConnect, 2 => !c.AutoConnect, 3 => Connected(c), _ => true })
            .Select(c => { var endpoint = ServerCatalog.Endpoint(c); return new ListViewItem(new[] { Connected(c) ? "Sim" : "Não", "—", c.AutoConnect ? "Sim" : "Não", c.Name, endpoint.Model, endpoint.Host, endpoint.Port, c.User, endpoint.Kind, monitor.IsRecording(c.Id) ? "Sim" : "Não", "—", "—" }) { Tag = c, Selected = selected.Contains(c.Id) }; }).ToList();
        data.Sort((a, b) => (descending ? -1 : 1) * (sortColumn == 6 && int.TryParse(a.SubItems[6].Text, out int left) && int.TryParse(b.SubItems[6].Text, out int right) ? left.CompareTo(right) : StringComparer.CurrentCultureIgnoreCase.Compare(a.SubItems[sortColumn].Text, b.SubItems[sortColumn].Text)));
        string snapshot = JsonSerializer.Serialize(data.Select(row => new { Id = ((Camera)row.Tag!).Id, Columns = row.SubItems.Cast<ListViewItem.ListViewSubItem>().Select(column => column.Text).ToArray() }));
        count.Text = $"{data.Count} de {store.Data.Cameras.Count} servidores • Conta, firmware e histórico offline não disponíveis";
        if (snapshot == lastRows) return;
        lastRows = snapshot;
        rows.BeginUpdate(); rows.Items.Clear(); rows.Items.AddRange(data.ToArray()); if (rows.Items.Count > top) rows.TopItem = rows.Items[top]; rows.EndUpdate();
    }
    void Export(bool selected, string format)
    {
        var cameras = selected ? Selected() : store.Data.Cameras.ToList();
        if (cameras.Count == 0) return;
        using var dialog = new SaveFileDialog { Filter = format + "|*." + format.ToLowerInvariant(), FileName = "servidores." + format.ToLowerInvariant() };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try { File.WriteAllText(dialog.FileName, format == "CSV" ? ServerCatalog.Csv(cameras) : ServerCatalog.Json(cameras), new UTF8Encoding(true)); }
        catch (Exception e) { MessageBox.Show(this, e.Message, "Exportação"); }
    }
    protected override void Dispose(bool disposing) { if (disposing) { refresh.Dispose(); menu.Dispose(); } base.Dispose(disposing); }
}

internal static class ServerCatalog
{
    public static (string Host, string Port, string Model, string Kind) Endpoint(Camera camera)
    {
        if (Uri.TryCreate(camera.Source, UriKind.Absolute, out var uri) && uri.Scheme is "rtsp" or "rtsps" or "http" or "https")
            return (uri.Host, (uri.Port > 0 ? uri.Port : uri.Scheme.StartsWith("rtsp") ? 554 : uri.Scheme == "https" ? 443 : 80).ToString(), uri.Scheme.ToUpperInvariant(), "Câmera IP");
        return ("", "", "Arquivo local", "Vídeo local");
    }
    public static string Json(IEnumerable<Camera> cameras) => JsonSerializer.Serialize(cameras.Select(c => { var e = Endpoint(c); return new { c.Name, c.Group, c.AutoConnect, e.Model, e.Host, e.Port, c.User, e.Kind, c.Notes }; }), new JsonSerializerOptions { WriteIndented = true });
    public static string Csv(IEnumerable<Camera> cameras)
    {
        static string Quote(string value) { if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value; return "\"" + value.Replace("\"", "\"\"") + "\""; }
        var lines = new List<string> { "Nome;Grupo;Ativo;Modelo;IP;Porta;Usuário;Tipo;Observações" };
        foreach (var c in cameras) { var e = Endpoint(c); lines.Add(string.Join(';', new[] { c.Name, c.Group, c.AutoConnect ? "Sim" : "Não", e.Model, e.Host, e.Port, c.User, e.Kind, c.Notes }.Select(Quote))); }
        return string.Join("\r\n", lines);
    }
}
