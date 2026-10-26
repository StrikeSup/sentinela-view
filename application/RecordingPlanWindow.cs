namespace IndependentCenter;

public sealed class RecordingPlanWindow : Form
{
    static readonly string[] Days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    public RecordingPlanWindow(Store store, Account account)
    {
        if (!account.CanConfigure) throw new UnauthorizedAccessException("Apenas administradores configuram gravação.");
        Text = "Gravação e agenda semanal"; ClientSize = new(800, 560); MinimumSize = new(780, 550);
        StartPosition = FormStartPosition.CenterParent;
        var camera = new ComboBox { Left = 20, Top = 35, Width = 750, DropDownStyle = ComboBoxStyle.DropDownList, DisplayMember = "Name", DataSource = store.Data.Cameras.ToList() };
        var enabled = new CheckBox { Left = 20, Top = 75, Width = 220, Text = "Habilitar gravação automática" };
        var mode = new ComboBox { Left = 280, Top = 75, Width = 250, DropDownStyle = ComboBoxStyle.DropDownList };
        mode.Items.AddRange(["Ininterrupta", "Programada"]);
        var grid = new DataGridView { Left = 20, Top = 120, Width = 750, Height = 270, AllowUserToAddRows = true, AllowUserToDeleteRows = true, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, RowHeadersWidth = 30, BackgroundColor = CenterTheme.Panel };
        grid.Columns.Add(new DataGridViewComboBoxColumn { HeaderText = "Dia", DataSource = Days });
        grid.Columns.Add("Start", "Início (HH:mm)"); grid.Columns.Add("End", "Fim (HH:mm, até 24:00)");
        var retention = new CheckBox { Left = 20, Top = 405, Width = 370, Text = "Excluir segmentos encerrados após o período:" };
        var days = new NumericUpDown { Left = 400, Top = 403, Width = 80, Minimum = 0, Maximum = 3650 };
        var hours = new NumericUpDown { Left = 550, Top = 403, Width = 70, Minimum = 0, Maximum = 23 };
        var help = new Label { Left = 20, Top = 440, Width = 750, Height = 55, Text = "A gravação funciona enquanto o Center estiver aberto, mesmo fora do layout. Horário local do Windows.\nRetenção remove somente arquivos novos identificados pelo Center. Para cruzar meia-noite, use duas faixas em dias consecutivos." };
        var save = new Button { Left = 565, Top = 505, Width = 100, Text = "Salvar" };
        var close = new Button { Left = 675, Top = 505, Width = 95, Text = "Fechar", DialogResult = DialogResult.Cancel };
        Controls.AddRange([new Label { Left = 20, Top = 15, Text = "Câmera", Width = 100 }, camera, enabled, mode, grid, retention, days, hours,
            new Label { Left = 485, Top = 407, Text = "dias", Width = 45 }, new Label { Left = 625, Top = 407, Text = "horas", Width = 50 }, help, save, close]);
        CancelButton = close;
        void LoadCamera()
        {
            grid.Rows.Clear();
            if (camera.SelectedItem is not Camera c) { save.Enabled = false; return; }
            save.Enabled = true; enabled.Checked = c.Recording.Enabled; mode.SelectedIndex = (int)c.Recording.Mode;
            retention.Checked = c.Recording.RetentionHours > 0; days.Value = c.Recording.RetentionHours / 24; hours.Value = c.Recording.RetentionHours % 24;
            foreach (var p in c.Recording.Periods) grid.Rows.Add(Days[(int)p.Day], Format(p.StartMinute), Format(p.EndMinute));
        }
        camera.SelectedIndexChanged += (_, _) => LoadCamera();
        mode.SelectedIndexChanged += (_, _) => grid.Enabled = mode.SelectedIndex == 1;
        retention.CheckedChanged += (_, _) => days.Enabled = hours.Enabled = retention.Checked;
        save.Click += (_, _) =>
        {
            if (camera.SelectedItem is not Camera c) return;
            try
            {
                grid.EndEdit();
                var plan = new RecordingPlan { Enabled = enabled.Checked, Mode = (RecordingMode)mode.SelectedIndex, RetentionHours = retention.Checked ? (int)(days.Value * 24 + hours.Value) : 0 };
                foreach (DataGridViewRow row in grid.Rows)
                {
                    if (row.IsNewRow) continue;
                    int day = Array.IndexOf(Days, Convert.ToString(row.Cells[0].Value));
                    plan.Periods.Add(new() { Day = (DayOfWeek)day, StartMinute = Parse(Convert.ToString(row.Cells[1].Value)), EndMinute = Parse(Convert.ToString(row.Cells[2].Value)) });
                }
                if (retention.Checked && plan.RetentionHours == 0) throw new ArgumentException("A retenção precisa ser de pelo menos uma hora.");
                plan.Validate();
                if (plan.RetentionHours > 0 && plan.RetentionHours != c.Recording.RetentionHours && MessageBox.Show(this,
                    "A retenção excluirá definitivamente os segmentos identificados do Center mais antigos que o período configurado. Ativar essa política?",
                    "Retenção de gravações", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
                var previous = c.Recording;
                try { c.Recording = plan; store.Save(); } catch { c.Recording = previous; throw; }
                store.Log("Plano de gravação atualizado: " + c.Id);
                MessageBox.Show(this, "Plano salvo. O motor aplica a alteração automaticamente.", "Gravação");
            }
            catch (Exception e) { MessageBox.Show(this, e.Message, "Configuração inválida", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        };
        LoadCamera(); days.Enabled = hours.Enabled = retention.Checked;
        CenterTheme.Apply(this);
    }
    static string Format(int minute) => $"{minute / 60:00}:{minute % 60:00}";
    internal static int Parse(string? text)
    {
        var parts = (text ?? "").Split(':');
        if (parts.Length != 2 || !int.TryParse(parts[0], out int h) || !int.TryParse(parts[1], out int m) || h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0))
            throw new ArgumentException("Informe um horário como 08:00 ou 18:30.");
        return h * 60 + m;
    }
}
