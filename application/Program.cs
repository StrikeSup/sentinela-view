using LibVLCSharp.Shared;

namespace IndependentCenter;
internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        bool reference = args.Contains("--reference");
        try
        {
            if(args.Contains("--diagnostics-test")){PlaybackDiagnosticsTest.Run();return;}
            if(args.Contains("--native-video-test")) {
                Core.Initialize(); NativeVideoTile.HardwareBackend=args.Contains("--dxva2")?"dxva2":"d3d11va"; using var nativeEngine = new LibVLC("--verbose=2", "--no-video-title-show",args.Contains("--dxva2")?"--vout=direct3d9":"--vout=direct3d11"); NativeDecodeProbe.Attach(nativeEngine);
                using var window = new NativeGuardianWindow(nativeEngine, ReadNativeCatalog, "http://127.0.0.1:8095", true, args.Contains("--all")?100:4);
                using var deadline = new System.Windows.Forms.Timer { Interval = 90000 };
                deadline.Tick += (_,_) => { deadline.Stop(); File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"native-video-test.json"),System.Text.Json.JsonSerializer.Serialize(window.Diagnostics(),new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));window.Close(); };
                deadline.Start(); Application.Run(window); return;
            }
            if (args.Contains("--local-web")||args.Contains("--guardian-app")||args.Contains("--guardian-native")) {
                Core.Initialize(); if(args.Contains("--guardian-native"))NativeVideoTile.HardwareBackend="dxva2"; using var localEngine = args.Contains("--guardian-native") ? new LibVLC("--quiet", "--no-video-title-show", "--vout=direct3d9") : new LibVLC("--quiet", "--no-plugins-cache");
                var webEquipment=new WebEquipment(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","guardian-data")));
                using var localServer = new CenterWebServer(localEngine, () => {
                    var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IndependentCenter", "settings.json");
                    var data = System.Text.Json.JsonSerializer.Deserialize<Settings>(File.ReadAllText(path)) ?? throw new InvalidDataException("Cadastro local inválido.");
                    if(data.SchemaVersion != 1) throw new InvalidDataException("Versão de cadastro incompatível.");
                    return Task.FromResult(new WebCatalog(data.Cameras.Concat(webEquipment.Cameras()).GroupBy(c=>c.Id).Select(g=>g.Last()).ToArray(), data.Accounts.ToArray()));
                }, equipment:webEquipment, licenses:new LocalServerLicenses(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","guardian-data"))), frontend:args.Contains("--guardian-app")||args.Contains("--guardian-native")?Path.Combine(AppContext.BaseDirectory,"guardian-web"):null);
                localServer.StartAsync().GetAwaiter().GetResult();
                if(args.Contains("--guardian-native")) {
                    Application.Run(new GuardianWindow(localServer.Address,engine:localEngine,catalog:ReadNativeCatalog));
                }
                else if(args.Contains("--guardian-app"))Application.Run(new GuardianWindow(localServer.Address));
                else Application.Run(new ApplicationContext()); return;
            }
            if (args.Contains("--self-test")) { SelfTest.Run(); return; }
            if (args.Contains("--registration-test")) { Core.Initialize();using var e=new LibVLC("--quiet","--no-plugins-cache");DahuaDriverTest.Run(e,true).GetAwaiter().GetResult();return; }
            if (args.Contains("--dahua-test")) { Core.Initialize(); using var driverEngine = new LibVLC("--quiet", "--no-plugins-cache"); DahuaDriverTest.Run(driverEngine).GetAwaiter().GetResult(); return; }
            if (args.Contains("--web-test") || args.Contains("--web-preview")) { Core.Initialize(); using var webEngine = new LibVLC("--quiet", "--no-plugins-cache"); WebServerTest.Run(webEngine, args.Contains("--web-preview")).GetAwaiter().GetResult(); return; }
            if (args.Contains("--onvif-test")) { OnvifTest.Run().GetAwaiter().GetResult(); return; }
            if (args.Contains("--ui-contract-test")) { Core.Initialize(); using var uiEngine = new LibVLC("--no-video-title-show", "--quiet", "--no-plugins-cache"); UiContractTest.Run(uiEngine); return; }
            using var instance = new Mutex(true, "Local\\IndependentCenter-" + Environment.UserName + (reference ? "-reference" : args.Contains("--demo") ? "-demo" : args.Contains("--media-test") ? "-test" : ""), out var firstInstance);
            if (!firstInstance) { MessageBox.Show("O Center já está aberto nesta sessão."); return; }
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"), "Core.Initialize\n");
            Core.Initialize();
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"), "LibVLC create\n");
            using var engine = new LibVLC("--no-video-title-show", "--quiet", "--no-plugins-cache");
            if (args.Contains("--media-test")) { MediaTest.Run(engine); return; }
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"), "Store create\n");
            var store = new Store(reference ? Path.Combine(AppContext.BaseDirectory, "reference-data") : args.Contains("--demo") ? Path.Combine(AppContext.BaseDirectory, "demo-data") : null);
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"), "Manager create\n");
            if (reference && store.Data.Cameras.Count == 0)
            {
                foreach (var name in new[] { "01 - PORTO ITACAR\u00c9", "02 - V81", "02 - V81 DVR 2", "05 - RUBEM ALVES", "07 - CHICAGO", "09 - SAN GOTARDO", "10 - RAMZA", "13 - MIRELLA", "16 - AVELINO", "45 - IPES" })
                    store.Data.Cameras.Add(new Camera { Name = name, Group = "DGUARD", Source = Path.Combine(AppContext.BaseDirectory, "demo.mp4"), AutoConnect = false });
                store.Save();
            }
            Account account;
            if (reference || args.Contains("--demo")) account = new() { Name = reference ? "admin" : "Demonstração", Role = "Administrador" };
            else { using var login = new LoginDialog(store); if (login.ShowDialog() != DialogResult.OK) return; account = login.Account!; }
            if(args.Contains("--intelbras-cloud-check")) {
                if(account.Role!="Administrador") { MessageBox.Show("Entre com uma conta administradora do Center para cadastrar equipamentos."); return; }
                using var dialog=new IntelbrasCloudDialog(args.SkipWhile(a=>a!="--intelbras-cloud-check").Skip(1).FirstOrDefault()??"");
                if(dialog.ShowDialog()!=DialogResult.OK)return;
                EquipmentCatalog.ImportProfiles(store,dialog.Cameras);
            }
            Application.Run(new ManagerWindow(store, engine, args.Contains("--demo"), account));
        }
        catch (Exception e) { MessageBox.Show(e.Message, "Center — falha ao iniciar", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { IntelbrasCloudTransport.Shutdown().GetAwaiter().GetResult(); }
    }
    static Task<WebCatalog> ReadNativeCatalog()
    {
        var path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"IndependentCenter","settings.json");
        var data=System.Text.Json.JsonSerializer.Deserialize<Settings>(File.ReadAllText(path))??throw new InvalidDataException("Cadastro inválido.");
        if(data.SchemaVersion!=1)throw new InvalidDataException("Versão de cadastro incompatível.");
        var equipment=new WebEquipment(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","guardian-data")));
        return Task.FromResult(new WebCatalog(data.Cameras.Concat(equipment.Cameras()).GroupBy(c=>c.Id).Select(g=>g.Last()).ToArray(),data.Accounts.ToArray()));
    }
}







