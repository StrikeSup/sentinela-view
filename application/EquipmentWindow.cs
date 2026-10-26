namespace IndependentCenter;

public sealed class EquipmentWindow : Form
{
    public EquipmentWindow(Store store, MonitorWindow monitor, Action<IReadOnlyList<Camera>> import, Action refresh)
    {
        Text = "Equipamentos e perfis"; ClientSize = new Size(900, 450); StartPosition = FormStartPosition.CenterParent;
        var rows = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false };
        foreach (var column in new[] { ("Equipamento", 150), ("Conector", 80), ("Endereço do serviço", 280), ("Canais / perfis", 120), ("Última descoberta", 180) }) rows.Columns.Add(column.Item1, column.Item2);
        var commands = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 85, Padding = new Padding(8) };
        Controls.Add(rows); Controls.Add(commands);
        Equipment? Selected() => rows.SelectedItems.Count == 1 ? rows.SelectedItems[0].Tag as Equipment : null;
        void Reload()
        {
            rows.Items.Clear(); foreach (var e in store.Data.Equipment)
            {
                var profiles = store.Data.Cameras.Where(c => c.EquipmentId == e.Id).ToArray();
                var channels = profiles.Any(c => c.ChannelToken.Length == 0) ? "?" : profiles.Select(c => c.ChannelToken).Distinct().Count().ToString();
                rows.Items.Add(new ListViewItem([e.Name, e.Connector, e.Endpoint, channels + " / " + profiles.Length, e.LastDiscovery.ToLocalTime().ToString("dd/MM/yyyy HH:mm")]) { Tag = e });
            }
        }
        void Button(string label, Action action)
        {
            var b = new Button { Text = label, Width = 160, Height = 28 }; commands.Controls.Add(b);
            b.Click += (_, _) => { try { action(); Reload(); } catch (Exception e) { MessageBox.Show(this, e.Message, "Equipamentos"); } };
        }
        Button("Fabricante e modelo", () => { using var d = new DeviceCatalogDialog(); if (d.ShowDialog(this) == DialogResult.OK) import(d.Cameras); });
        Button("Intelbras Cloud", () => { using var d = new IntelbrasCloudDialog(); if(d.ShowDialog(this)==DialogResult.OK) import(d.Cameras); });
        Button("Adicionar ONVIF", () => { using var d = new OnvifDialog(); if (d.ShowDialog(this) == DialogResult.OK) import(d.Cameras); });
        Button("Redescobrir perfis", () =>
        {
            if (Selected() is not { } equipment) return;
            var profile = store.Data.Cameras.FirstOrDefault(c => c.EquipmentId == equipment.Id);
            if(equipment.Connector=="IntelbrasCloud") { using var cloud=new IntelbrasCloudDialog(new Uri(equipment.Endpoint).Host,profile?.User??"",profile?.Password??"",DeviceCatalog.Find(equipment.VendorId,equipment.ModelId),profile is null?554:new Uri(profile.Source).Port); if(cloud.ShowDialog(this)==DialogResult.OK) import(cloud.Cameras); return; }
            var model = DeviceCatalog.Find(equipment.VendorId,equipment.ModelId);
            if(equipment.Connector == "DahuaHTTP" && model?.DahuaDiscovery != true) throw new InvalidDataException("Modelo CGI não encontrado no catálogo.");
            var rtspPort = profile is not null && Uri.TryCreate(profile.Source,UriKind.Absolute,out var stream) && stream.Port > 0 ? stream.Port : 554;
            using var d = new OnvifDialog(equipment.Endpoint, profile?.User ?? "", profile?.Password ?? "", model, rtspPort);
            if (d.ShowDialog(this) == DialogResult.OK) import(d.Cameras);
        });
        Button("Conectar perfis", () => { if (Selected() is { } e) foreach (var c in store.Data.Cameras.Where(c => c.EquipmentId == e.Id)) monitor.AddCamera(c); });
        Button("Desconectar perfis", () => { if (Selected() is { } e) foreach (var c in store.Data.Cameras.Where(c => c.EquipmentId == e.Id)) monitor.Connect(c.Id, false); });
        Button("Remover cadastro", () =>
        {
            if (Selected() is not { } e || MessageBox.Show(this, "Remover o equipamento e seus perfis? Os arquivos de gravação serão preservados.", "Remover equipamento", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            var removed = store.Data.Cameras.Where(c => c.EquipmentId == e.Id).ToArray();
            var oldCameras = store.Data.Cameras; var oldEquipment = store.Data.Equipment;
            store.Data.Cameras = oldCameras.Except(removed).ToList(); store.Data.Equipment = oldEquipment.Where(x => x.Id != e.Id).ToList();
            try { store.Save(); } catch { store.Data.Cameras = oldCameras; store.Data.Equipment = oldEquipment; throw; }
            foreach (var c in removed) { monitor.StopRecording(c.Id); foreach (var cell in monitor.Cells.Where(x => x.Camera?.Id == c.Id)) cell.Assign(null); }
            refresh();
        });
        Reload(); CenterTheme.Apply(this);
    }
}

