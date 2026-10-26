using LibVLCSharp.Shared;
namespace IndependentCenter;

internal static class UiContractTest
{
    public static void Run(LibVLC engine)
    {
        var report = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException(name); report.Add("PASS " + name); }
        try
        {
            var portChoice = new ServerPortChoice();
            Check(portChoice.SelectModel(80) == 80, "new model supplies default port");
            portChoice.Edit(8080); Check(portChoice.SelectModel(554) == 8080, "manual port survives model change");
            portChoice.Load(8554, true); Check(portChoice.SelectModel(80) == 8554, "existing server port preserved");
            var exportCamera = new Camera { Name = "=SUM(1;2)", Group = "Teste", Source = "rtsp://example.invalid:8554/live?token=private-token", User = "operator", Notes = "Linha 1\nLinha \"2\"" }; exportCamera.Password = TestCredentials.Password;
            var exportedJson = ServerCatalog.Json(new[] { exportCamera }); var exportedCsv = ServerCatalog.Csv(new[] { exportCamera });
            Check(!exportedJson.Contains(TestCredentials.Password) && !exportedJson.Contains("private-token") && !exportedJson.Contains("ProtectedPassword"), "JSON export excludes credentials and URL query");
            Check(exportedCsv.Contains("' =".Replace(" ", "")) && exportedCsv.Contains("\"\"2\"\"") && !exportedCsv.Contains(TestCredentials.Password) && !exportedCsv.Contains("private-token"), "CSV escapes formulas, quotes and excludes secrets");
            foreach (var count in new[] { 1, 4, 6, 8, 9, 13, 16, 25, 64, 100 })
            {
                var geometry = LayoutGeometry.Create(count);
                var occupied = new HashSet<Point>();
                Check(geometry.Slots.Length == count, $"layout {count}: camera count");
                foreach (var slot in geometry.Slots)
                    for (int y = slot.Top; y < slot.Bottom; y++)
                        for (int x = slot.Left; x < slot.Right; x++)
                            if (x >= geometry.Side || y >= geometry.Side || !occupied.Add(new Point(x, y))) throw new InvalidOperationException($"layout {count}: overlap or overflow");
                Check(occupied.Count == geometry.Side * geometry.Side, $"layout {count}: complete coverage, no overlap");
            }
            var assets = Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Assets", "Dark"));
            Check(assets.Length == 753, "753 original dark assets deployed");
            foreach (var file in assets) { using var image = Image.FromFile(file); if (image.Width < 1 || image.Height < 1) throw new InvalidDataException(file); }
            report.Add("PASS 753 original images decoded");
            using var dialog = new CameraDialog();
            static IEnumerable<Control> Descendants(Control root) => root.Controls.Cast<Control>().SelectMany(c => new[] { c }.Concat(Descendants(c)));
            Check(Descendants(dialog).OfType<ComboBox>().Any(c => c.Items.Cast<object>().Any(i => i.ToString()!.StartsWith("ONVIF"))), "new camera offers implemented ONVIF discovery");
            dialog.PerformLayout();
            Check(dialog.FormBorderStyle == FormBorderStyle.None, "server form uses custom chrome");
            Check(dialog.ContentPanel.Controls.Count > 0, "server form contains controls");
            static void Layout(Control root) { root.PerformLayout(); foreach (Control child in root.Controls) Layout(child); }
            static void ValidateBounds(Control root)
            {
                foreach (Control child in root.Controls)
                {
                    if (root is not ScrollableControl { AutoScroll: true } && child.Dock == DockStyle.None && (child.Left < 0 || child.Top < 0 || child.Right > root.ClientSize.Width + 2 || child.Bottom > root.ClientSize.Height + 2))
                        throw new InvalidOperationException($"Clipped control {child.GetType().Name} '{child.Text}': {child.Bounds}, parent {root.ClientSize}");
                    ValidateBounds(child);
                }
            }
            Layout(dialog); ValidateBounds(dialog.ContentPanel); report.Add("PASS server form controls inside their containers");
            foreach (float scale in new[] { 1.25f, 1.5f, 2f })
            {
                using var scaled = new CameraDialog(); scaled.MinimumSize = Size.Empty; scaled.MaximumSize = Size.Empty; scaled.Scale(new SizeF(scale, scale));
                Layout(scaled); ValidateBounds(scaled.ContentPanel); report.Add($"PASS server form bounds at scale {scale}");
            }
            var store = new Store(Path.Combine(AppContext.BaseDirectory, "ui-contract-test", Guid.NewGuid().ToString("N")));
            store.Data.Cameras.Add(new Camera { Name = "Notes test", Notes = "Observações preservadas" }); store.Save();
            Check(new Store(store.Root).Data.Cameras[0].Notes == "Observações preservadas", "server notes persist through reload");
            using var monitor = new MonitorWindow(store, engine, new Account { Name = "UI test", Role = "Administrador" });
            foreach (int count in new[] { 6, 8, 13, 16, 100 }) { monitor.SetGrid(count); Check(monitor.Cells.Count == count, $"monitor constructs {count} cells"); }
            Check(monitor.FormBorderStyle == FormBorderStyle.None, "monitor uses custom chrome");
            using var manager = new ManagerWindow(store, engine, false, new Account { Name = "UI test", Role = "Administrador" });
            manager.PerformLayout();
            Check(manager.FormBorderStyle == FormBorderStyle.None, "manager uses custom chrome");
            using var serverList = new ServerListWindow(store, monitor, new Account { Name = "UI test", Role = "Administrador" }, _ => { }, () => { });
            Check(serverList.Text == "Lista de servidores", "server list constructs from stored cameras");
            using var equipmentWindow = new EquipmentWindow(store, monitor, _ => { }, () => { });
            Layout(equipmentWindow); ValidateBounds(equipmentWindow);
            report.Add("PASS equipment window controls fit inside containers");
            using var catalogDialog = new DeviceCatalogDialog();
            Layout(catalogDialog); ValidateBounds(catalogDialog);
            var vendorList = catalogDialog.Controls.OfType<ComboBox>().Single();
            Check(vendorList.Items.Count == 385, "equipment dialog offers complete manufacturer catalog");
            vendorList.SelectedItem = DeviceCatalog.Vendors.First(v=>v.Name == "Intelbras");
            var modelList = catalogDialog.Controls.OfType<ListBox>().Single();
            Check(modelList.Items.Count == 500, "manufacturer selection loads all matching models");
            modelList.SelectedItem = intelbrasUnsupported();
            DeviceModel intelbrasUnsupported() => DeviceCatalog.Vendors.First(v=>v.Name == "Intelbras").Models.First(m=>!m.OnvifDiscovery && !m.DahuaDiscovery);
            Check(!catalogDialog.Controls.OfType<Button>().Single(b=>b.Text == "Consultar via ONVIF").Enabled, "unimplemented proprietary connector cannot masquerade as ONVIF");
            modelList.SelectedItem=DeviceCatalog.Vendors.First(v=>v.Name == "Intelbras").Models.First(m=>m.DahuaDiscovery);
            Check(catalogDialog.Controls.OfType<Button>().Single(b=>b.Text == "Consultar via CGI Dahua").Enabled,"catalog dispatches recovered Dahua family to dedicated CGI client");
            using var dahuaDialog=new OnvifDialog(model:(DeviceModel)modelList.SelectedItem!);
            Layout(dahuaDialog); ValidateBounds(dahuaDialog);
            Check(dahuaDialog.Text.Contains("CGI Dahua"),"CGI dialog exposes HTTP address and explicit RTSP port");
            report.Add("LIMITATION: structural checks only; no live screenshot or visual equivalence asserted.");
        }
        catch (Exception ex) { report.Add("FAIL " + ex); Environment.ExitCode = 1; }
        File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, "ui-contract-test.txt"), report);
    }
}
