namespace IndependentCenter;
public sealed class PtzPanel : Panel
{
    bool busy; readonly Func<Camera?> selected; readonly Label status;
    public PtzPanel(Func<Camera?> selected, bool allowed)
    {
        this.selected = selected; Width = 280; Height = 344;
        var title = new Label { Text = "CONTROLE PTZ", Left = 10, Top = 8, Width = 260, Height = 20 };
        Controls.Add(title);
        var joystick = new PictureBox { Left = 21, Top = 36, Width = 165, Height = 165, Image = UiAssets.Get("imjoystickcenter"), SizeMode = PictureBoxSizeMode.Zoom, Enabled = allowed, Cursor = Cursors.Hand };
        Controls.Add(joystick);
        var speed = new TrackBar { Left = 190, Top = 110, Width = 75, Height = 26, Minimum = 1, Maximum = 10, Value = 3, TickStyle = TickStyle.None, AutoSize = false, Enabled = allowed };
        Controls.Add(speed); Controls.Add(new Label { Text = "VELOCIDADE", Left = 190, Top = 96, Width = 80, Height = 16, Font = new Font("Tahoma", 6.75f) });
        joystick.MouseClick += async (_, e) => { float halfX = Math.Max(1, joystick.ClientSize.Width / 2f), halfY = Math.Max(1, joystick.ClientSize.Height / 2f); float x = (e.X - halfX) / halfX, y = (halfY - e.Y) / halfY; if (Math.Abs(x) + Math.Abs(y) < .2f) return; await MoveCamera(Math.Clamp(x, -1, 1) * speed.Value / 10, Math.Clamp(y, -1, 1) * speed.Value / 10, 0); };
        foreach (var spec in new[] { ("bxzoomin", 1f, 50), ("bxzoomout", -1f, 176) })
        {
            var zoom = new Button { Left = 170, Top = spec.Item3, Width = 20, Height = 20, Image = UiAssets.Get(spec.Item1), FlatStyle = FlatStyle.Flat, Enabled = allowed, AccessibleName = spec.Item2 > 0 ? "Aproximar" : "Afastar" };
            zoom.FlatAppearance.BorderSize = 0; zoom.Click += async (_, _) => await MoveCamera(0, 0, spec.Item2 * speed.Value / 10); Controls.Add(zoom);
        }
        Controls.Add(new Label { Text = "PATRULHA", Left = 18, Top = 211, Width = 240, Height = 15 });
        Controls.Add(new ComboBox { Left = 18, Top = 227, Width = 240, Height = 20, Enabled = false, DropDownStyle = ComboBoxStyle.DropDownList, AccessibleDescription = "Patrulha do dispositivo ainda indispon?vel" });
        Controls.Add(new Label { Text = "PRESET", Left = 18, Top = 252, Width = 240, Height = 15 });
        Controls.Add(new ComboBox { Left = 18, Top = 268, Width = 240, Height = 20, Enabled = false, DropDownStyle = ComboBoxStyle.DropDownList, AccessibleDescription = "Presets ainda indispon?veis" });
        for (int i = 0; i < 10; i++) Controls.Add(new Button { Left = 18 + i * 24, Top = 295, Width = 22, Height = 22, Text = (i + 1).ToString(), Enabled = false, FlatStyle = FlatStyle.Flat });
        status = new Label { Text = allowed ? "" : "Controle dispon?vel para operadores.", Left = 18, Top = 321, Width = 245, Height = 20, AutoEllipsis = true }; Controls.Add(status);
        CenterTheme.Apply(this);
    }

    async Task MoveCamera(float pan, float tilt, float zoom)
    {
        if (busy) return; var camera = selected(); if (camera is null || string.IsNullOrWhiteSpace(camera.PtzAddress)) { status.Text = "A câmera selecionada não anunciou PTZ."; return; }
        busy = true; status.Text = "Movimentando…";
        try { using var client = new OnvifClient(camera.OnvifAddress, camera.User, camera.Password, TimeSpan.FromSeconds(4)); await client.MovePulse(camera.PtzAddress, camera.ProfileToken, pan, tilt, zoom); if (!IsDisposed) status.Text = "Movimento concluído; parada enviada."; }
        catch (Exception e) { if (!IsDisposed) status.Text = e is TaskCanceledException ? "Tempo esgotado. Confira a câmera." : e.Message; }
        finally { busy = false; }
    }
}
