using LibVLCSharp.Shared;
using System.Collections.Concurrent;
using System.Text.Json;
namespace IndependentCenter;
static class NativeDecodeProbe
{
    static readonly ConcurrentDictionary<string,int> counts=new();
    public static void Attach(LibVLC engine){engine.Log+=(_,e)=>{
        // Only fixed diagnostic labels are retained, never source URLs or credentials.
        var m=e.Message.ToLowerInvariant();string? key=null;
        if(m.Contains("using d3d11va"))key="using-d3d11va";
        else if(m.Contains("using dxva2"))key="using-dxva2";
        else if(m.Contains("using video decoder module"))key="decoder-selected";
        else if((e.Module.Contains("d3d11")||e.Module.Contains("avcodec"))&&e.Level==LogLevel.Error)key="decoder-or-output-error";
        if(key is not null)counts.AddOrUpdate(key,1,(_,n)=>n+1);
    };}
    public static void Save(){try{File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"native-decode-probe.json"),JsonSerializer.Serialize(counts));}catch(IOException){}}
}
