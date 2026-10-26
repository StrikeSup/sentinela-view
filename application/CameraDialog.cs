namespace IndependentCenter;

// Structure and coordinates follow TFMSERVCADASTRO at 96 DPI.
public sealed class CameraDialog : StyledWindow
{
    readonly TextBox name = new(), host = new(), source = new(), group = new(), user = new();
    readonly TextBox password = new() { UseSystemPasswordChar = true };
    readonly NumericUpDown port = new() { Minimum = 1, Maximum = 65535, Value = 554 };
    readonly CheckBox automatic = new() { Text = "Servidor ativo", AutoSize = true };
    readonly ComboBox model = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    readonly Label address = new() { AutoEllipsis = true, Cursor = Cursors.Hand };
    readonly Label type = new() { Text = "Câmera IP", AutoSize = true };
    readonly TextBox requirements = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical };
    readonly TreeView tree = new() { HideSelection = false, BorderStyle = BorderStyle.None };
    readonly ToolTip hints = new();
    readonly TextBox notesText = new() { Multiline = true, MaxLength = 1000, ScrollBars = ScrollBars.Vertical };
    readonly Camera? original;
    string baselineHost = ""; int baselinePort = 554, baselineModel;
    bool loading;
    readonly ServerPortChoice portChoice = new();
    public Camera Result { get; private set; } = new();
    public List<Camera> ImportedCameras { get; } = [];

    public CameraDialog(Camera? camera = null)
    {
        original = camera; Text = "Configuração Servidores"; Font = new Font("Verdana", 8f);
        AutoScaleMode = AutoScaleMode.Dpi; ClientSize = new Size(782, 604);
        MinimumSize = MaximumSize = Size; StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = false;
        var canvas = new Panel { Dock = DockStyle.Fill, BackColor = CenterTheme.Surface };
        ContentPanel.Controls.Add(canvas);
        canvas.Controls.Add(new Label { Text = camera?.Group ?? "Servidores", Bounds = new Rectangle(8, 4, 760, 23), Padding = new Padding(4, 4, 0, 0) });
        var serverList = Card(canvas, "Selecione o servidor", 8, 31, 244, 514);
        tree.Bounds = new Rectangle(4, 23, 236, 487); serverList.Controls.Add(tree);
        var root = tree.Nodes.Add(camera?.Group ?? "Servidores");
        var selectedNode = root.Nodes.Add(camera?.Name ?? "Novo servidor"); root.Expand(); tree.SelectedNode = selectedNode;
        var server = Card(canvas, "Servidor", 266, 31, 245, 290);
        Field(server, "Nome do servidor", name, 13, 25, 217);
        Field(server, "IP ou domínio", host, 13, 68, 217);
        Field(server, "Porta", port, 13, 109, 66);
        var advanced = new LinkLabel { Text = "Configurações avançadas", Bounds = new Rectangle(83, 130, 155, 22), LinkColor = Color.Silver, ActiveLinkColor = Color.White };
        server.Controls.Add(advanced); advanced.Click += (_, _) => Advanced();
        automatic.Location = new Point(13, 155); server.Controls.Add(automatic);
        hints.SetToolTip(automatic, "Conectar esta câmera automaticamente ao abrir o Center.");
        DisabledOption(server, "Redirecionador Seventh", 176); DisabledOption(server, "Otimizar uso de banda", 197); DisabledOption(server, "Conexão inversa", 218);
        var timeout = new CheckBox { Text = "Time-out", Location = new Point(13, 241), AutoSize = true, Enabled = false };
        var timeoutValue = new NumericUpDown { Minimum = 10, Maximum = 600, Value = 60, Bounds = new Rectangle(117, 239, 60, 22), Enabled = false };
        server.Controls.AddRange([timeout, timeoutValue]);
        hints.SetToolTip(timeout, "Tempo de conexão individual ainda não disponível nesta implementação.");
        var connection = Card(canvas, "Tipo de servidor", 522, 31, 246, 183);
        var vendor = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; vendor.Items.Add("Genérico");
        if (camera is null) vendor.Items.Add("ONVIF — equipamentos compatíveis");
        else if (camera.OnvifAddress.Length > 0) vendor.Items.Add("ONVIF — perfil importado");
        if (camera is null) vendor.Items.Add("Selecionar fabricante e modelo…");
        vendor.SelectedIndex = 0;
        if (camera?.OnvifAddress.Length > 0) { vendor.SelectedIndex = 1; vendor.Enabled = false; }
        Field(connection, "Fabricante", vendor, 10, 25, 222);
        model.Items.AddRange(["RTSP / RTSPS", "HTTP / HTTPS", "Arquivo local"]);
        Field(connection, "Modelo", model, 10, 77, 222);
        connection.Controls.Add(new Label { Text = "Tipo", Bounds = new Rectangle(10, 129, 55, 19) }); type.Location = new Point(75, 129); connection.Controls.Add(type);
        var login = Card(canvas, "Dados de login", 522, 222, 246, 199);
        Field(login, "Usuário", user, 10, 40, 192); Field(login, "Senha", password, 10, 87, 192);
        var reveal = new Button { Text = "◉", Bounds = new Rectangle(205, 105, 28, 21), TabStop = false, FlatStyle = FlatStyle.Flat };
        reveal.FlatAppearance.BorderSize = 0; reveal.AccessibleName = "Mostrar senha enquanto pressionado";
        reveal.MouseDown += (_, _) => password.UseSystemPasswordChar = false; reveal.MouseUp += (_, _) => password.UseSystemPasswordChar = true; reveal.MouseLeave += (_, _) => password.UseSystemPasswordChar = true;
        login.Controls.Add(reveal); login.Controls.Add(new Label { Text = "URL:", Bounds = new Rectangle(10, 154, 35, 20) });
        address.Bounds = new Rectangle(44, 154, 188, 20); address.Click += (_, _) => Advanced(); login.Controls.Add(address);
        var product = Card(canvas, "Center", 266, 329, 245, 92);
        product.Controls.Add(new Label { Text = "Center", Font = new Font("Verdana", 18, FontStyle.Bold), Bounds = new Rectangle(5, 25, 233, 60), TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.Silver });
        var info = Card(canvas, "Informações e requisitos", 266, 429, 245, 82);
        requirements.Bounds = new Rectangle(4, 21, 237, 57); requirements.BorderStyle = BorderStyle.FixedSingle; info.Controls.Add(requirements);
        var notes = Card(canvas, "Observações", 522, 429, 246, 82);
        notesText.Bounds = new Rectangle(4, 21, 238, 57); notesText.Text = camera?.Notes ?? ""; notes.Controls.Add(notesText);
        var save = new Button { Text = "Salvar", Bounds = new Rectangle(438, 529, 78, 25) };
        var cancel = new Button { Text = "Cancelar", Bounds = new Rectangle(523, 529, 78, 25), DialogResult = DialogResult.Cancel };
        canvas.Controls.AddRange([save, cancel]); AcceptButton = save; CancelButton = cancel;
        name.MaxLength = 70; host.MaxLength = 255;
        name.Text = camera?.Name ?? ""; source.Text = camera?.Source ?? ""; group.Text = camera?.Group ?? "Servidores";
        user.Text = camera?.User ?? ""; password.Text = camera?.Password ?? ""; automatic.Checked = camera?.AutoConnect ?? false;
        LoadAddress();
        model.SelectedIndexChanged += (_, _) => { if (!loading) { loading = true; if (model.SelectedIndex < 2) port.Value = portChoice.SelectModel(model.SelectedIndex == 0 ? 554 : 80); loading = false; UpdateRequirements(); } };
        host.TextChanged += (_, _) => RefreshAddressLabel(); port.ValueChanged += (_, _) => { if (!loading) portChoice.Edit((int)port.Value); RefreshAddressLabel(); };
        name.TextChanged += (_, _) => selectedNode.Text = string.IsNullOrWhiteSpace(name.Text) ? "Novo servidor" : name.Text;
        save.Click += (_, _) => SaveCamera(); CenterTheme.Apply(canvas); canvas.BackColor = CenterTheme.Surface; UpdateRequirements();
        vendor.SelectedIndexChanged += (_, _) =>
        {
            if (camera is null && vendor.SelectedIndex == 2)
            {
                using var catalog = new DeviceCatalogDialog();
                if (catalog.ShowDialog(this) == DialogResult.OK) { ImportedCameras.AddRange(catalog.Cameras); DialogResult = DialogResult.OK; }
                else vendor.SelectedIndex = 0;
                return;
            }
            if (camera is not null || vendor.SelectedIndex != 1) return;
            string endpoint = "";
            if (!string.IsNullOrWhiteSpace(host.Text))
                try { endpoint = new UriBuilder("http", host.Text.Trim(), (int)port.Value == 554 ? 80 : (int)port.Value, "/onvif/device_service").Uri.AbsoluteUri; }
                catch (UriFormatException) { }
            using var discovery = new OnvifDialog(endpoint, user.Text, password.Text);
            if (discovery.ShowDialog(this) == DialogResult.OK)
            {
                foreach (var imported in discovery.Cameras) { imported.AutoConnect = automatic.Checked; imported.Notes = notesText.Text; ImportedCameras.Add(imported); }
                DialogResult = DialogResult.OK;
            }
            else vendor.SelectedIndex = 0;
        };
    }
    static Panel Card(Control parent, string title, int x, int y, int width, int height)
    {
        var panel = new Panel { Bounds = new Rectangle(x, y, width, height), BorderStyle = BorderStyle.FixedSingle };
        panel.Controls.Add(new Label { Text = title, Bounds = new Rectangle(4, 2, width - 10, 18), ForeColor = Color.Silver });
        parent.Controls.Add(panel); return panel;
    }
    static void Field(Control parent, string label, Control control, int x, int y, int width)
    {
        parent.Controls.Add(new Label { Text = label, Bounds = new Rectangle(x, y, width, 17) });
        control.Bounds = new Rectangle(x, y + 19, width, 21); parent.Controls.Add(control);
    }
    void DisabledOption(Control parent, string text, int y)
    {
        var option = new CheckBox { Text = text, Location = new Point(13, y), AutoSize = true, Enabled = false };
        parent.Controls.Add(option); hints.SetToolTip(option, "Recurso proprietário ainda não implementado.");
    }
    void LoadAddress()
    {
        loading = true;
        if (Uri.TryCreate(source.Text, UriKind.Absolute, out var uri) && new[] { "rtsp", "rtsps", "http", "https" }.Contains(uri.Scheme))
        {
            host.Text = uri.Host; port.Value = uri.Port > 0 ? uri.Port : uri.Scheme.StartsWith("rtsp") ? 554 : 80;
            model.SelectedIndex = uri.Scheme.StartsWith("rtsp") ? 0 : 1;
        }
        else { host.Text = ""; model.SelectedIndex = string.IsNullOrWhiteSpace(source.Text) ? 0 : 2; }
        baselineHost = host.Text; baselinePort = (int)port.Value; baselineModel = model.SelectedIndex; portChoice.Load(baselinePort, !string.IsNullOrWhiteSpace(source.Text)); loading = false;
    }
    string CurrentSource()
    {
        if (model.SelectedIndex == 2) return source.Text.Trim();
        var value = source.Text.Trim();
        if (host.Text == baselineHost && (int)port.Value == baselinePort && model.SelectedIndex == baselineModel && value.Length > 0) return value;
        if (string.IsNullOrWhiteSpace(host.Text)) throw new UriFormatException("Informe o endereço.");
        if (Uri.TryCreate(value, UriKind.Absolute, out var old) && new[] { "rtsp", "rtsps", "http", "https" }.Contains(old.Scheme))
        {
            var builder = new UriBuilder(old) { Host = host.Text.Trim(), Port = (int)port.Value };
            if (model.SelectedIndex != baselineModel) builder.Scheme = model.SelectedIndex == 0 ? "rtsp" : "http";
            return builder.Uri.AbsoluteUri;
        }
        return new UriBuilder(model.SelectedIndex == 0 ? "rtsp" : "http", host.Text.Trim(), (int)port.Value).Uri.AbsoluteUri;
    }
    void RefreshAddressLabel()
    {
        try { address.Text = CurrentSource(); } catch (UriFormatException) { address.Text = "Informe o endereço"; }
    }
    void UpdateRequirements()
    {
        bool file = model.SelectedIndex == 2; host.Enabled = port.Enabled = !file; user.Enabled = password.Enabled = !file;
        type.Text = file ? "Arquivo de vídeo" : "Câmera IP";
        requirements.Text = file ? "Selecione um vídeo em Configurações avançadas. Reprodução local; sem conexão a um servidor." : "Use a URL completa do stream em Configurações avançadas. Este modo usa RTSP/HTTP; protocolos proprietários de fabricantes ainda não estão disponíveis.";
        RefreshAddressLabel();
    }
    void Advanced()
    {
        using var dialog = new StyledWindow { Text = "Configurações avançadas", ClientSize = new Size(560, 210), StartPosition = FormStartPosition.CenterParent, MaximizeBox = false, MinimizeBox = false, Font = Font };
        var panel = dialog.ContentPanel; var url = new TextBox { Text = source.Text };
        try { url.Text = CurrentSource(); } catch (UriFormatException) { }
        var category = new TextBox { Text = group.Text };
        Field(panel, "URL completa do stream ou caminho do arquivo", url, 14, 9, 528); Field(panel, "Grupo", category, 14, 57, 528);
        var browse = new Button { Text = "Arquivo…", Bounds = new Rectangle(14, 117, 90, 27) };
        var ok = new Button { Text = "Aplicar", Bounds = new Rectangle(360, 117, 87, 27), DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancelar", Bounds = new Rectangle(455, 117, 87, 27), DialogResult = DialogResult.Cancel };
        panel.Controls.AddRange([browse, ok, cancel]); dialog.AcceptButton = ok; dialog.CancelButton = cancel;
        browse.Click += (_, _) => { using var picker = new OpenFileDialog { Filter = "Vídeos|*.mp4;*.mkv;*.avi;*.ts;*.mov|Todos|*.*" }; if (picker.ShowDialog(dialog) == DialogResult.OK) url.Text = picker.FileName; };
        CenterTheme.Apply(panel);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        source.Text = url.Text.Trim(); group.Text = category.Text.Trim();
        if (tree.Nodes.Count > 0) tree.Nodes[0].Text = group.Text;
        LoadAddress(); UpdateRequirements();
    }
    void SaveCamera()
    {
        if (name.Text.Trim().Length < 3) { MessageBox.Show(this, "O nome deve ter pelo menos três caracteres."); return; }
        string s; try { s = CurrentSource(); } catch (UriFormatException) { MessageBox.Show(this, "Informe um endereço válido."); return; }
        if (model.SelectedIndex == 2 && !File.Exists(s)) { MessageBox.Show(this, "Selecione um arquivo existente em Configurações avançadas."); return; }
        if (model.SelectedIndex != 2 && (!Uri.TryCreate(s, UriKind.Absolute, out var uri) || !new[] { "rtsp", "rtsps", "http", "https" }.Contains(uri.Scheme))) { MessageBox.Show(this, "Informe uma URL RTSP/HTTP válida."); return; }
        if (Uri.TryCreate(s, UriKind.Absolute, out var u) && u.UserInfo.Length > 0) { MessageBox.Show(this, "Coloque as credenciais nos campos Usuário e Senha, não na URL."); return; }
        Result = new Camera { Id = original?.Id ?? Guid.NewGuid(), Name = name.Text.Trim(), Group = group.Text.Trim(), Source = s, User = user.Text, AutoConnect = automatic.Checked, Notes = notesText.Text, Recording = original?.Recording ?? new() }; Result.Password = password.Text;
        Result.EquipmentId = s == original?.Source ? original.EquipmentId : null;
        Result.VendorId = s == original?.Source ? original.VendorId : null;
        Result.ModelId = s == original?.Source ? original.ModelId : null;
        Result.DeviceConnector = s == original?.Source ? original.DeviceConnector : "";
        Result.DeviceAddress = s == original?.Source ? original.DeviceAddress : "";
        Result.ChannelToken = s == original?.Source ? original.ChannelToken : "";
        if (s == original?.Source) { Result.OnvifAddress = original.OnvifAddress; Result.PtzAddress = original.PtzAddress; Result.ProfileToken = original.ProfileToken; }
        DialogResult = DialogResult.OK;
    }
    protected override void Dispose(bool disposing) { if (disposing) hints.Dispose(); base.Dispose(disposing); }
}
