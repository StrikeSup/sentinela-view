using System.Diagnostics;
namespace IndependentCenter;
sealed class PlaybackDiagnostics
{
    readonly object gate=new();
    readonly Dictionary<Guid,Entry> entries=[];
    sealed class Entry{
        public Guid Id,Camera;public string Owner="";public DateTimeOffset Created=DateTimeOffset.UtcNow,Updated=DateTimeOffset.UtcNow;
        public long Start=Stopwatch.GetTimestamp();public List<object> Stages=[];public ClientSample? Client;
    }
    public static object? NativeSnapshot;
    public sealed record ClientSample(double ElapsedMs,long Frames,long Bytes,int? Freezes,int Reconnects,bool Presented,bool Connected,bool Retained,double? FirstFrameMs);
    void Prune(){foreach(var key in entries.Where(p=>p.Value.Updated<DateTimeOffset.UtcNow.AddMinutes(-30)).Select(p=>p.Key).ToArray())entries.Remove(key);while(entries.Count>=512)entries.Remove(entries.MinBy(p=>p.Value.Created).Key);}
    public Guid Begin(Guid camera,string owner){lock(gate){Prune();var e=new Entry{Id=Guid.NewGuid(),Camera=camera,Owner=owner};entries[e.Id]=e;Mark(e.Id,"request-received");return e.Id;}}
    public void Mark(Guid id,string stage){lock(gate){if(!entries.TryGetValue(id,out var e)||e.Stages.Count>=64)return;e.Updated=DateTimeOffset.UtcNow;e.Stages.Add(new{stage,ms=Math.Round(Stopwatch.GetElapsedTime(e.Start).TotalMilliseconds)});}}
    public bool Report(Guid id,string owner,ClientSample sample){lock(gate){if(!entries.TryGetValue(id,out var e)||e.Owner!=owner)return false;
        if(!double.IsFinite(sample.ElapsedMs)||sample.ElapsedMs<0||sample.ElapsedMs>86400000||sample.Frames<0||sample.Bytes<0||sample.Freezes<0||sample.Reconnects<0||sample.FirstFrameMs is double f&&(!double.IsFinite(f)||f<0||f>86400000))return false;
        e.Client=sample;e.Updated=DateTimeOffset.UtcNow;return true;}}
    public object Snapshot(string owner){lock(gate){Prune();using var p=Process.GetCurrentProcess();return new{native=NativeSnapshot,at=DateTimeOffset.UtcNow,memoryBytes=p.WorkingSet64,cpuSeconds=p.TotalProcessorTime.TotalSeconds,logicalProcessors=Environment.ProcessorCount,
        requests=entries.Values.Where(e=>e.Owner==owner).OrderByDescending(e=>e.Created).Select(e=>new{id=e.Id,camera=e.Camera,created=e.Created,updated=e.Updated,stages=e.Stages.ToArray(),client=e.Client}).ToArray()};}}
}
