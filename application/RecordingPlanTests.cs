namespace IndependentCenter;
static class RecordingPlanTests
{
    public static void Run(Action<bool, string> check, string root)
    {
        var monday = new DateTime(2026, 10, 26, 8, 0, 0);
        var plan = new RecordingPlan { Enabled = true, Mode = RecordingMode.Scheduled, Periods = [new() { Day = DayOfWeek.Monday, StartMinute = 480, EndMinute = 540 }] };
        plan.Validate();
        check(!plan.IsDue(monday.AddSeconds(-1)) && plan.IsDue(monday) && plan.IsDue(monday.AddMinutes(59)) && !plan.IsDue(monday.AddHours(1)), "Agenda inclui início e exclui fim do período");
        check(!plan.IsDue(monday.AddDays(1)), "Agenda distingue dias da semana");
        plan.Enabled = false; check(!plan.IsDue(monday), "Plano desabilitado não grava"); plan.Enabled = true;
        plan.Mode = RecordingMode.Continuous; check(plan.IsDue(monday.AddDays(1)), "Gravação contínua independe de agenda");
        bool Reject(RecordingPlan invalid) { try { invalid.Validate(); return false; } catch (ArgumentException) { return true; } }
        check(Reject(new() { Enabled = true, Mode = RecordingMode.Scheduled }), "Agenda habilitada exige período");
        check(Reject(new() { Periods = [new() { StartMinute = 100, EndMinute = 100 }] }), "Agenda rejeita intervalo vazio");
        check(Reject(new() { Periods = Enumerable.Range(0, 4).Select(i => new RecordingPeriod { StartMinute = i * 60, EndMinute = (i + 1) * 60 }).ToList() }), "Agenda rejeita quarta faixa no mesmo dia");
        check(Reject(new() { Periods = [new() { StartMinute = 60, EndMinute = 120 }, new() { StartMinute = 119, EndMinute = 180 }] }), "Agenda rejeita sobreposição");
        var adjacent = new RecordingPlan { Periods = [new() { StartMinute = 60, EndMinute = 120 }, new() { StartMinute = 120, EndMinute = 180 }] }; adjacent.Validate();
        check(RecordingPlanWindow.Parse("24:00") == 1440 && RecordingPlanWindow.Parse("08:30") == 510, "Horários suportam fim do dia e minutos");
        var store = new Store(Path.Combine(root, "recording-plan")); var camera = new Camera { Recording = plan }; store.Data.Cameras.Add(camera); store.Save();
        check(new Store(store.Root).Data.Cameras[0].Recording.Periods[0].StartMinute == 480, "Plano persiste com identidade da câmera");
        var directory = Path.Combine(store.Data.RecordingDirectory, camera.Id.ToString()); Directory.CreateDirectory(directory);
        var now = DateTimeOffset.UtcNow;
        var old = Path.Combine(directory, "old.ts"); File.WriteAllText(old, "synthetic"); RecordingRetention.MarkCompleted(old, camera.Id, now.AddHours(-3));
        var fresh = Path.Combine(directory, "fresh.ts"); File.WriteAllText(fresh, "synthetic"); RecordingRetention.MarkCompleted(fresh, camera.Id, now);
        var unindexed = Path.Combine(directory, "unindexed.ts"); File.WriteAllText(unindexed, "synthetic"); File.SetLastWriteTimeUtc(unindexed, now.AddYears(-1).UtcDateTime);
        check(RecordingRetention.Clean(store, camera, now) == 0 && File.Exists(old), "Retenção desligada preserva todos os arquivos");
        camera.Recording.RetentionHours = 2;
        check(RecordingRetention.Clean(store, camera, now) == 1 && !File.Exists(old) && File.Exists(fresh) && File.Exists(unindexed), "Retenção remove somente segmento encerrado, indexado e vencido");
        var outside = Path.Combine(store.Data.RecordingDirectory, "outside.ts"); File.WriteAllText(outside, "synthetic");
        var forged = new RecordingRetention.CompletedFile("IndependentCenter.Recording.v1", camera.Id, "../outside.ts", now.AddDays(-1));
        File.WriteAllText(Path.Combine(directory, "forged.ts.center-recording.json"), System.Text.Json.JsonSerializer.Serialize(forged));
        check(RecordingRetention.Clean(store, camera, now) == 0 && File.Exists(outside), "Retenção recusa caminho fora da pasta da câmera");
    }
}
