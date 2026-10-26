using LibVLCSharp.Shared;
using System.Runtime.InteropServices;
namespace IndependentCenter;
static class MediaTest
{
    public static void Run(LibVLC engine)
    {
        var result = new List<string>(); var root = Path.Combine(AppContext.BaseDirectory, "media-test"); Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(AppContext.BaseDirectory, "demo.mp4"); if (!File.Exists(source)) throw new FileNotFoundException(source);
            using var player = new MediaPlayer(engine); int frames = 0; var buffer = Marshal.AllocHGlobal(640 * 360 * 4);
            try
            {
                player.SetVideoFormat("RV32", 640, 360, 640 * 4);
                player.SetVideoCallbacks((opaque, planes) => { Marshal.WriteIntPtr(planes, buffer); return IntPtr.Zero; }, null, (opaque, picture) => Interlocked.Increment(ref frames));
                using var media = new Media(engine, source, FromType.FromPath); player.Play(media);
                if (!SpinWait.SpinUntil(() => Volatile.Read(ref frames) >= 15, TimeSpan.FromSeconds(15))) throw new Exception("Decodificação não entregou 15 quadros.");
                result.Add("PASS decode: " + frames + " frames");
                player.SetPause(true); Thread.Sleep(500); if (player.State != VLCState.Paused) throw new Exception("Pause falhou"); result.Add("PASS pause");
                var snapshot = Path.Combine(root, "snapshot.png"); if (File.Exists(snapshot)) File.Delete(snapshot);
                if (!player.TakeSnapshot(0, snapshot, 0, 0) || !SpinWait.SpinUntil(() => File.Exists(snapshot) && new FileInfo(snapshot).Length > 1000, TimeSpan.FromSeconds(5))) throw new Exception("Snapshot falhou."); result.Add("PASS snapshot PNG");
                player.SetPause(false); player.Position = .5f; Thread.Sleep(1000); if (player.Position < .45f) throw new Exception("Seek falhou"); result.Add("PASS seek and resume"); player.Stop();
            }
            finally { player.Stop(); Marshal.FreeHGlobal(buffer); }
            var store = new Store(root); using var recording = new RecordingService(store, engine); var camera = new Camera { Name = "Synthetic", Source = source }; var path = recording.Start(camera, TimeSpan.FromSeconds(3)); Thread.Sleep(4000); recording.Tick(); recording.Stop(camera.Id);
            if (!File.Exists(path) || new FileInfo(path).Length < 1000) throw new Exception("Gravação vazia"); result.Add("PASS recording: " + path); File.WriteAllLines(Path.Combine(root, "results.txt"), result);
            store.Data.Cameras.Clear(); store.Data.Cameras.Add(camera);
            using (var first = new RecordingService(store, engine)) { first.Start(camera, null); Thread.Sleep(500); }
            var restoredStore = new Store(root);
            if (restoredStore.Data.EmergencyRecordings.Count != 1) throw new Exception("Estado de gravação não persistiu.");
            using (var restored = new RecordingService(restoredStore, engine)) { restored.Restore(); if (!restored.IsRecording(camera.Id)) throw new Exception("Retomada falhou."); restored.Stop(camera.Id); }
            if (new Store(root).Data.EmergencyRecordings.Count != 0) throw new Exception("Cancelamento não persistiu."); result.Add("PASS recording restart and explicit stop persistence");
            restoredStore.Data.EmergencyRecordings.Add(new() { CameraId = camera.Id, Expires = DateTimeOffset.Now.AddSeconds(-1) }); restoredStore.Save();
            using (var expired = new RecordingService(restoredStore, engine)) { expired.Restore(); if (expired.IsRecording(camera.Id) || restoredStore.Data.EmergencyRecordings.Count != 0) throw new Exception("Gravação vencida foi retomada."); }
            result.Add("PASS expired recording not resumed");
            var scheduledStore = new Store(Path.Combine(root, "automatic"));
            var scheduledCamera = new Camera { Name = "Scheduled synthetic", Source = source, Recording = new() { Enabled = true, Mode = RecordingMode.Continuous } };
            scheduledStore.Data.Cameras.Add(scheduledCamera); scheduledStore.Save();
            bool emergency = false;
            using (var automatic = new AutomaticRecording(scheduledStore, engine, _ => emergency))
            {
                var time = DateTimeOffset.Now; automatic.Tick(time); Thread.Sleep(1500);
                if (!automatic.IsRecording(scheduledCamera.Id) || scheduledStore.Data.EmergencyRecordings.Count != 0) throw new Exception("Gravação automática não iniciou ou invadiu estado emergencial.");
                result.Add("PASS automatic recording starts independently of layout and emergency state");
                emergency = true; automatic.Tick(time.AddSeconds(2));
                if (automatic.IsRecording(scheduledCamera.Id)) throw new Exception("Prioridade emergencial falhou.");
                result.Add("PASS emergency recording suspends automatic session");
                emergency = false; automatic.Tick(time.AddSeconds(61)); Thread.Sleep(1000);
                if (!automatic.IsRecording(scheduledCamera.Id)) throw new Exception("Retomada automática falhou.");
                scheduledCamera.Recording.Enabled = false; automatic.Tick(time.AddSeconds(63));
                if (automatic.IsRecording(scheduledCamera.Id)) throw new Exception("Desabilitação não interrompeu gravação automática.");
                result.Add("PASS automatic resumes then stops when disabled");
            }
            var generated = Directory.GetFiles(scheduledStore.Data.RecordingDirectory, "*.ts", SearchOption.AllDirectories);
            if (!generated.Any(p => new FileInfo(p).Length > 1000 && File.Exists(p + ".center-recording.json"))) throw new Exception("Segmento automático não foi gravado/indexado.");
            result.Add("PASS automatic media segment and completed index written");
            File.WriteAllLines(Path.Combine(root, "results.txt"), result);
        }
        catch (Exception e) { File.WriteAllLines(Path.Combine(root, "results.txt"), result.Append(e.ToString())); Environment.ExitCode = 1; }
    }
}
