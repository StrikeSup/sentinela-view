using System.Text.Json;
namespace IndependentCenter;
static class PlaybackDiagnosticsTest
{
    public static void Run(){
        var d=new PlaybackDiagnostics();var id=d.Begin(Guid.NewGuid(),"test-owner-secret");
        var sample=new PlaybackDiagnostics.ClientSample(100,1,10,null,0,true,true,false,90);
        void Check(bool value,string name){if(!value)throw new InvalidOperationException(name);}
        Check(!d.Report(id,"other",sample),"Owner isolation");
        Check(!d.Report(id,"test-owner-secret",sample with{ElapsedMs=double.NaN}),"Reject invalid time");
        Check(!d.Report(id,"test-owner-secret",sample with{Bytes=-1}),"Reject negative bytes");
        Check(d.Report(id,"test-owner-secret",sample),"Accept valid sample");
        var json=JsonSerializer.Serialize(d.Snapshot("test-owner-secret"));
        Check(!json.Contains("test-owner-secret"),"No session secrets serialized");
        using var other=JsonDocument.Parse(JsonSerializer.Serialize(d.Snapshot("other")));
        Check(other.RootElement.GetProperty("requests").GetArrayLength()==0,"Read isolation");
        for(int i=0;i<600;i++)d.Begin(Guid.NewGuid(),"test-owner-secret");
        using var bounded=JsonDocument.Parse(JsonSerializer.Serialize(d.Snapshot("test-owner-secret")));
        Check(bounded.RootElement.GetProperty("requests").GetArrayLength()<=512,"Bounded retention");
        File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"diagnostics-test.txt"),"PASS: owner isolation, invalid time, negative bytes, valid sample, secret exclusion, read isolation, bounded retention.");
    }
}
