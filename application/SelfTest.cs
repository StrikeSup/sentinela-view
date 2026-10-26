using System.Text.Json;
namespace IndependentCenter;
static class SelfTest
{
    public static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "Center-test-" + Guid.NewGuid()); Directory.CreateDirectory(root);
        var results = new List<string>();
        void Check(bool valid, string name) { if (!valid) throw new Exception("FAIL: " + name); results.Add("PASS: " + name); }
        try
        {
            RecordingPlanTests.Run(Check, root);
            EquipmentTests.Run(Check, root);
            var store = new Store(root); var camera = new Camera { Name = "Camera teste", Source = "rtsp://localhost:8554/test", User = "test" }; camera.Password = TestCredentials.Password; store.Data.Cameras.Add(camera); store.Save();
            var firstLayout=Guid.NewGuid();var secondLayout=Guid.NewGuid();var now=DateTimeOffset.UtcNow;
            var plan=new PatrolPlan{Name="Ronda",Steps=[new(){LayoutId=firstLayout,Seconds=5},new(){LayoutId=secondLayout,Seconds=12}]};var runner=new PatrolRunner(plan,now);
            Check(runner.Current==firstLayout&&runner.Advance(now.AddSeconds(4)) is null,"Ronda respeita duração inicial");
            Check(runner.Advance(now.AddSeconds(5))==secondLayout&&runner.Advance(now.AddSeconds(16)) is null,"Ronda aplica duração por posição");
            Check(runner.Advance(now.AddSeconds(17))==firstLayout,"Ronda retorna ao primeiro layout");
            store.Data.Patrols.Add(plan);store.Save();Check(new Store(root).Data.Patrols[0].Steps[1].Seconds==12,"Ronda persiste ordem e tempos");
            var user = new Account { Name = "admin", Role = "Administrador" }; user.SetPassword("password-for-test"); Check(user.Verify("password-for-test") && !user.Verify("wrong"), "PBKDF2 valida e rejeita senhas"); Check(user.CanConfigure && user.CanOperate, "Permissão administrador"); var viewer = new Account { Role = "Visualizador" }; Check(!viewer.CanConfigure && !viewer.CanOperate, "Visualizador não configura nem grava");
            var serialized = File.ReadAllText(Path.Combine(root, "settings.json")); Check(!serialized.Contains(TestCredentials.Password), "Senha não persistida em texto simples");
            var restored = new Store(root); Check(restored.Data.Cameras[0].Password == TestCredentials.Password, "DPAPI round trip"); Check(restored.Data.Cameras[0].Id == camera.Id, "Identidade persistida");
            var queue = new ConnectionQueue(); var a = Guid.NewGuid(); var b = Guid.NewGuid(); var connected = new List<Guid>(); queue.Enqueue(a, true); queue.Enqueue(a, true); queue.Enqueue(b, true); queue.Tick(connected.Add, _ => true); Check(connected.SequenceEqual(new[] { a }), "Um connect por tick"); queue.Tick(connected.Add, _ => true); queue.Tick(connected.Add, _ => true); Check(connected.SequenceEqual(new[] { a, b }), "Fila sem duplicação");
            queue.Enqueue(a, true); queue.Enqueue(a, false); var stopped = new List<Guid>(); queue.Tick(connected.Add, id => { stopped.Add(id); return true; }); Check(connected.Count == 2 && stopped.SequenceEqual(new[] { a }), "Desconexão cancela conexão pendente");
            for (int i = 0; i < 7; i++) queue.Enqueue(Guid.NewGuid(), false); int n = 0; queue.Tick(_ => { }, _ => { n++; return true; }); Check(n == 4, "Limite de quatro desconexões ativas");
            store.Data.Layouts.Add(new() { Name = "Teste", Cells = 4, Cameras = [camera.Id, null, null, null] }); store.Save(); Check(new Store(root).Data.Layouts[0].Cameras[0] == camera.Id, "Layout preserva câmeras");
            File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, "self-test.txt"), results);
        }
        catch (Exception e) { File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, "self-test.txt"), results.Append(e.ToString())); Environment.ExitCode = 1; }
    }
}
