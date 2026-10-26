using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
namespace IndependentCenter;

// Local-only WHEP relay. Camera credentials never enter browser responses.
public sealed class LocalWebRtc : IDisposable
{
    readonly HttpClient http = new(){Timeout=TimeSpan.FromSeconds(100)};
    readonly SemaphoreSlim gate = new(1,1);
    readonly Dictionary<Guid,string> paths = new();
    readonly System.Collections.Concurrent.ConcurrentDictionary<Guid,(string Owner,Uri Url)> sessions = new();
    readonly System.Collections.Concurrent.ConcurrentDictionary<Guid,Guid> sessionCameras = new();
    readonly Dictionary<Guid,Process> transcoders = new();
    public async Task<object> Diagnostics(CancellationToken ct){
        try{using var response=await http.GetAsync("http://127.0.0.1:19997/v3/paths/list?itemsPerPage=1000",ct);
            if(!response.IsSuccessStatusCode)return new{available=false};
            using var doc=System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var rows=doc.RootElement.GetProperty("items").EnumerateArray().Select(p=>new{source=p.GetProperty("name").GetString(),ready=p.GetProperty("ready").GetBoolean(),readers=p.GetProperty("readers").GetArrayLength()}).ToArray();
            return new{available=true,sessions=sessions.Count,sources=rows.Select(p=>new{p.source,p.ready,p.readers,shared=p.readers>1,retained=p.ready&&p.readers==0}).ToArray()};
        }catch(Exception e)when(e is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException){return new{available=false};}
    }
    async Task<string> CompatiblePath(Camera camera,CancellationToken ct){
        var name=$"c{camera.Id:N}";
        using var state=await http.GetAsync($"http://127.0.0.1:19997/v3/paths/get/{name}",ct);
        if(!state.IsSuccessStatusCode)return name;
        using var doc=System.Text.Json.JsonDocument.Parse(await state.Content.ReadAsStringAsync(ct));
        if(!doc.RootElement.TryGetProperty("tracks",out var tracks)||!tracks.EnumerateArray().Any(t=>t.GetString()=="H265"))return name;
        await gate.WaitAsync(ct);
        try{
            var output=$"web{camera.Id:N}";
            if(transcoders.TryGetValue(camera.Id,out var running)&&!running.HasExited)return output;
            var exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"ffmpeg.exe");
            if(!File.Exists(exe))throw new IOException("O vídeo usa H.265 e requer FFmpeg para conversão local.");
            using var configRequest=new HttpRequestMessage(HttpMethod.Post,$"http://127.0.0.1:19997/v3/config/paths/add/{output}"){Content=JsonContent.Create(new{source="publisher"})};
            using var configured=await http.SendAsync(configRequest,ct);
            var auth="center:"+Password+"@127.0.0.1:18554/";
            var psi=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
            foreach(var arg in new[]{"-hide_banner","-loglevel","error","-nostdin","-rtsp_transport","tcp","-i","rtsp://"+auth+name,"-an","-vf","scale=1280:-2","-r","15","-c:v","libx264","-preset","ultrafast","-tune","zerolatency","-pix_fmt","yuv420p","-g","30","-bf","0","-f","rtsp","-rtsp_transport","tcp","rtsp://"+auth+output})psi.ArgumentList.Add(arg);
            var process=Process.Start(psi)??throw new IOException("Conversor de vídeo não iniciou.");process.ErrorDataReceived+=(_,_)=>{};process.OutputDataReceived+=(_,_)=>{};process.BeginErrorReadLine();process.BeginOutputReadLine();transcoders[camera.Id]=process;
            return output;
        }finally{gate.Release();}
    }
    readonly System.Collections.Concurrent.ConcurrentDictionary<Guid,(Guid Equipment,string Via)> activeRoutes = new();
    public async Task<object[]> Connections(CancellationToken ct) {
        var found=new List<(Guid Equipment,string Via)>();
        foreach(var item in activeRoutes){
            try {
                using var response=await http.GetAsync($"http://127.0.0.1:19997/v3/paths/get/c{item.Key:N}",ct);
                if(!response.IsSuccessStatusCode)continue;
                using var doc=System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                var data=doc.RootElement;
                if(data.TryGetProperty("ready",out var ready)&&ready.GetBoolean()&&data.TryGetProperty("readers",out var readers)&&readers.GetArrayLength()>0)found.Add(item.Value);
            }catch(HttpRequestException){}catch(System.Text.Json.JsonException){}
        }
        return found.GroupBy(x=>x.Equipment).Select(g=>(object)new{id=g.Key,via=string.Join(" / ",g.Select(x=>x.Via).Distinct())}).ToArray();
    }
    Process? process; string? config;
    public LocalWebRtc() {
        var password=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Basic",Convert.ToBase64String(Encoding.UTF8.GetBytes("center:"+password)));
        Password=password;
    }
    readonly string Password;
    async Task Ensure(Camera camera,CancellationToken ct) {
        await gate.WaitAsync(ct);
        try {
            if(process is null) {
                var exe=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../local-media/mediamtx/mediamtx.exe"));
                if(!File.Exists(exe))throw new IOException("Relay WebRTC não instalado.");
                config=Path.Combine(AppContext.BaseDirectory,"mediamtx-local.yml");
                File.WriteAllText(config,$"logLevel: error\napi: yes\napiAddress: 127.0.0.1:19997\nrtsp: yes\nrtspAddress: 127.0.0.1:18554\nrtspTransports: [tcp]\nrtmp: no\nhls: no\nsrt: no\nwebrtc: yes\nwebrtcAddress: 127.0.0.1:18889\nwebrtcLocalUDPAddress: 127.0.0.1:18189\nwebrtcIPsFromInterfaces: no\nwebrtcAdditionalHosts: [127.0.0.1]\nauthMethod: internal\nauthInternalUsers:\n  - user: center\n    pass: {Password}\n    ips: [127.0.0.1]\n    permissions:\n      - action: publish\n        path: \"\"\n      - action: api\n      - action: read\n        path: \"\"\npaths: {{}}\n");
                var psi=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add(config);
                process=Process.Start(psi)??throw new IOException("Não foi possível iniciar o relay.");
                for(int i=0;i<30;i++){try{using var ping=await http.GetAsync("http://127.0.0.1:19997/v3/config/global/get",ct);if(ping.IsSuccessStatusCode)break;}catch(HttpRequestException){}await Task.Delay(100,ct);}
            }
            var source=new UriBuilder(await IntelbrasCloudTransport.Prepare(camera,ct));
            if(source.Scheme!="rtsp"&&source.Scheme!="rtsps")throw new InvalidOperationException("WebRTC local requer uma fonte RTSP.");
            source.UserName=camera.User;source.Password=camera.Password;
            if(paths.TryGetValue(camera.Id,out var previous)&&previous==source.Uri.AbsoluteUri)return;
            var operation=paths.ContainsKey(camera.Id)?"patch":"add";
            using var request=new HttpRequestMessage(operation=="patch"?HttpMethod.Patch:HttpMethod.Post,$"http://127.0.0.1:19997/v3/config/paths/{operation}/c{camera.Id:N}") {Content=JsonContent.Create(new{source=source.Uri.AbsoluteUri,sourceOnDemand=true,sourceOnDemandStartTimeout="90s",sourceOnDemandCloseAfter="10s",rtspTransport="tcp"})};
            using var response=await http.SendAsync(request,ct);
            if(!response.IsSuccessStatusCode)throw new IOException("Relay recusou a configuração da fonte.");
            paths[camera.Id]=source.Uri.AbsoluteUri;
        } finally {gate.Release();}
    }
    public async Task<(Guid Id,string Answer)> Offer(Camera camera,string owner,string offer,CancellationToken ct,string? via=null,Action<string>? mark=null) {
        if(camera.ConnectionRoutes.Count>0){
            foreach(var route in camera.ConnectionRoutes){
                var candidate=System.Text.Json.JsonSerializer.Deserialize<Camera>(System.Text.Json.JsonSerializer.Serialize(camera))!;
                candidate.ConnectionRoutes=[];
                if(camera.DeviceConnector!="" || route.Kind=="cloud"){
                    candidate.DeviceConnector=route.Kind=="cloud"?"IntelbrasCloud":"DahuaHTTP";
                    candidate.DeviceAddress=route.Kind=="cloud"?"ibcloud://"+route.Host+"/":new UriBuilder("http",route.Host,route.HttpPort).Uri.AbsoluteUri;
                    candidate.Source=new UriBuilder(camera.Source){Host=route.Kind=="cloud"?"127.0.0.1":route.Host,Port=route.RtspPort}.Uri.AbsoluteUri;
                }
                mark?.Invoke(route.Kind=="cloud"?"cloud-attempt":"ip-attempt");
                using var routeDeadline=CancellationTokenSource.CreateLinkedTokenSource(ct);
                routeDeadline.CancelAfter(TimeSpan.FromSeconds(route.Kind=="cloud"?45:12));
                try{return await Offer(candidate,owner,offer,routeDeadline.Token,route.Kind=="interno"?"IP interno":route.Kind=="externo"?"IP externo":"Intelbras Cloud",mark);}
                catch(Exception e)when((e is IOException or HttpRequestException or OperationCanceledException)&&!ct.IsCancellationRequested){mark?.Invoke("route-failed");}
            }
            throw new IOException("Nenhuma conexão na ordem configurada abriu o vídeo.");
        }
        mark?.Invoke("source-prepare-start");
        await Ensure(camera,ct);mark?.Invoke("source-configured");
        var uri=new Uri($"http://127.0.0.1:18889/c{camera.Id:N}/whep");
        using var request=new HttpRequestMessage(HttpMethod.Post,uri){Content=new StringContent(offer,Encoding.UTF8,"application/sdp")};
        using var response=await http.SendAsync(request,ct);
        HttpResponseMessage selected=response;
        if(!response.IsSuccessStatusCode){
            mark?.Invoke("whep-rejected-check-codec");var compatible=await CompatiblePath(camera,ct);
            if(compatible==$"c{camera.Id:N}")throw new IOException("Não foi possível abrir WebRTC. Verifique conexão e compatibilidade H.264 do equipamento.");
            uri=new Uri($"http://127.0.0.1:18889/{compatible}/whep");
            for(int attempt=0;attempt<30;attempt++){
                using var check=await http.GetAsync($"http://127.0.0.1:19997/v3/paths/get/{compatible}",ct);
                if(check.IsSuccessStatusCode){using var status=System.Text.Json.JsonDocument.Parse(await check.Content.ReadAsStringAsync(ct));if(status.RootElement.GetProperty("ready").GetBoolean())break;}
                await Task.Delay(500,ct);
            }
            using var retry=new HttpRequestMessage(HttpMethod.Post,uri){Content=new StringContent(offer,Encoding.UTF8,"application/sdp")};
            selected=await http.SendAsync(retry,ct);
            if(!selected.IsSuccessStatusCode){selected.Dispose();throw new IOException("A conversão H.265 para H.264 não abriu o vídeo.");}
        }
        mark?.Invoke("whep-session-ready");
        var location=selected.Headers.Location??throw new IOException("Relay não retornou a sessão.");
        var url=new Uri(uri,location);
        if(url.Host!="127.0.0.1"||url.Port!=18889)throw new IOException("Destino de sessão inválido.");
        var id=Guid.NewGuid();sessions[id]=(owner,url);
        sessionCameras[id]=camera.Id;
        activeRoutes[camera.Id]=(camera.EquipmentId??camera.Id,via??(camera.DeviceConnector=="IntelbrasCloud"?"Intelbras Cloud":"IP (cadastro de origem)"));
        var answer=await selected.Content.ReadAsStringAsync(ct);if(selected!=response)selected.Dispose();return(id,answer);
    }
    public async Task<bool> Close(Guid id,string owner,CancellationToken ct){
        if(!sessions.TryGetValue(id,out var session)||session.Owner!=owner)return false;
        sessions.TryRemove(id,out _);using var result=await http.DeleteAsync(session.Url,ct);
        if(sessionCameras.TryRemove(id,out var camera)&&!sessionCameras.Values.Contains(camera)){await gate.WaitAsync(ct);try{if(transcoders.Remove(camera,out var converter)){if(!converter.HasExited)converter.Kill(true);converter.Dispose();}}finally{gate.Release();}}return true;
    }
    public void Dispose(){http.Dispose();foreach(var converter in transcoders.Values){try{if(!converter.HasExited)converter.Kill(true);}catch(InvalidOperationException){}converter.Dispose();}if(process is not null){try{if(!process.HasExited)process.Kill(true);}catch(InvalidOperationException){}process.Dispose();}if(config is not null)File.Delete(config);}
}

