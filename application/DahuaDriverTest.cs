using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using LibVLCSharp.Shared;
namespace IndependentCenter;

static class DahuaDriverTest
{
    public static async Task Run(LibVLC engine, bool registrationOnly=false)
    {
        var results=new List<string>(); var requests=new List<string>();
        var log=new System.Collections.Concurrent.ConcurrentQueue<string>();
        engine.Log+=(_,e)=>log.Enqueue(e.Message);
        void Check(bool value,string message) { if(!value) throw new Exception(message); results.Add("PASS "+message); }
        static string Md5(string text)=>Convert.ToHexString(MD5.HashData(Encoding.ASCII.GetBytes(text))).ToLowerInvariant();
        var builder=WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.ConfigureKestrel(o=>o.Listen(IPAddress.Loopback,0));
        await using var server=builder.Build(); string mode="normal"; int authenticated=0; bool transportMatches=true;
        server.Run(async ctx=>
        {
            var auth=ctx.Request.Headers.Authorization.ToString();
            var fields=Regex.Matches(auth,"(\\w+)=(?:\"([^\"]*)\"|([^, ]+))").ToDictionary(m=>m.Groups[1].Value,m=>m.Groups[2].Success?m.Groups[2].Value:m.Groups[3].Value);
            string F(string name)=>fields.GetValueOrDefault(name,"");
            var uri=ctx.Request.Path+ctx.Request.QueryString;
            var ha1=Md5("operator:fixture:test-password");
            if(mode=="md5-sess") ha1=Md5(ha1+":fixture-nonce:"+F("cnonce"));
            var expected=Md5(ha1+":fixture-nonce:"+F("nc")+":"+F("cnonce")+":auth:"+Md5("GET:"+uri));
            var accepted=mode=="basic" ? auth=="Basic "+Convert.ToBase64String(Encoding.ASCII.GetBytes("operator:test-password")) :
                auth.StartsWith("Digest ") && F("username")=="operator" && F("realm")=="fixture" && F("nonce")=="fixture-nonce" && F("qop")=="auth" && F("uri")==uri && F("response")==expected;
            transportMatches &= ctx.Request.Protocol=="HTTP/1.1" && ctx.Request.Headers.Connection.ToString().Equals("close",StringComparison.OrdinalIgnoreCase);
            if(!accepted)
            {ctx.Response.StatusCode=401;ctx.Response.Headers.WWWAuthenticate=mode=="basic" ? "Basic realm=\"fixture\"" : "Digest realm=\"fixture\", nonce=\"fixture-nonce\", algorithm="+(mode=="md5-sess"?"MD5-sess":"MD5")+", qop=\"auth\"";return;}
            Interlocked.Increment(ref authenticated); lock(requests) requests.Add(uri);
            if(mode=="slow") {try{await Task.Delay(1500,ctx.RequestAborted);}catch(OperationCanceledException){return;}}
            if(mode=="error") {ctx.Response.StatusCode=500;return;}
            if(mode=="redirect") {ctx.Response.Redirect("http://127.0.0.1:1/");return;}
            if(mode=="malformed") {await ctx.Response.WriteAsync("<html>not a camera</html>");return;}
            if(mode=="created") ctx.Response.StatusCode=201;
            if(mode=="empty") return;
            if(mode=="forbidden") {ctx.Response.StatusCode=403;return;}
            var body=uri switch
            {
                "/cgi-bin/magicBox.cgi?action=getDeviceType"=>"type=Fixture-DVR\r\n",
                "/cgi-bin/devVideoInput.cgi?action=getCollect"=>"result=1\r\n",
                "/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxRemoteInputChannels"=>"table.MaxRemoteInputChannels=1\r\n",
                "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle"=>mode=="empty-name" ? "table.ChannelTitle[0].Name=\r\ntable.ChannelTitle[1].Name=Garagem\r\n" : "table.ChannelTitle[0].Name=Entrada\r\ntable.ChannelTitle[1].Name=Garagem\r\n",
                "/cgi-bin/magicBox.cgi?action=getSoftwareVersion"=>"version=fixture-1\r\n",
                "/cgi-bin/configManager.cgi?action=getConfig&name=RTSP"=>"table.RTSP.Port=8554\r\n",
                _=>null
            };
            if(body is null){ctx.Response.StatusCode=501;return;} await ctx.Response.WriteAsync(body);
        });
        try
        {
            await server.StartAsync(); var address=server.Urls.Single();
            if(registrationOnly){await WebEquipmentTest.Run(engine,address,Check);return;}
            using var client=new DahuaHttpClient(address,"operator","test-password");
            var profiles=await client.Profiles(18554,2);
            Check(profiles.Count==4 && profiles[0].StreamUri=="rtsp://127.0.0.1:18554/cam/realmonitor?channel=1&subtype=0" && profiles[3].StreamUri.EndsWith("channel=2&subtype=1"),"CGI discovery produces exact channel/subtype RTSP URLs");
            Check(authenticated==5 && profiles[0].Name.StartsWith("Entrada") && profiles[2].Name.StartsWith("Garagem") && client.Firmware=="fixture-1","five actual HTTP operations authenticated with verified Digest; channel names and firmware parsed");
            Check(transportMatches,"HTTP/1.1 and Connection Close match original queue on challenge and authenticated requests");
            Check(await client.ReadRtspPort()==8554,"device-reported RTSP port overrides a default port assumption");
            foreach(var authMode in new[]{"basic","md5-sess"})
            {
                mode=authMode; using var authClient=new DahuaHttpClient(address,"operator","test-password");
                Check((await authClient.Profiles(554,1)).Count==2,authMode+" challenge authenticates over actual HTTP");
            }
            mode="empty-name";
            Check((await client.Profiles(554,1))[0].Name.StartsWith("Canal 1"),"empty device title preserves a usable default channel name");
            mode="normal";
            Check((await client.Profiles(554,2,channelCapacity:1)).Count==2,"reported channels cannot exceed selected model capacity");
            Check((await client.Profiles(554,1,channelCapacity:8)).Count==2,"model capacity does not fabricate missing device channels");
            using(var wrong=new DahuaHttpClient(address,"operator","wrong"))
            { try{await wrong.Profiles(554,1);throw new Exception("Bad credentials accepted");}catch(UnauthorizedAccessException){results.Add("PASS rejected credentials do not import profiles");} }
            foreach(var scenario in new[]{"malformed","error","redirect","slow","created","empty","forbidden"})
            {
                mode=scenario; using var failed=new DahuaHttpClient(address,"operator","test-password",TimeSpan.FromMilliseconds(200));
                try{await failed.Profiles(554,1);throw new Exception("Failure accepted: "+scenario);}
                catch(Exception e) when (e is InvalidDataException or System.Net.Http.HttpRequestException or OperationCanceledException or UnauthorizedAccessException) {results.Add("PASS "+scenario+" fails without fabricated channels");}
            }
            mode="normal";
            var model=DeviceCatalog.Vendors.SelectMany(v=>v.Models).First(m=>m.DahuaDiscovery);
            var cameras=profiles.Select(p=>new Camera{Name=p.Name,Source=p.StreamUri,Group="Fixture",DeviceConnector="DahuaHTTP",DeviceAddress=address,ProfileToken=p.Token,ChannelToken=p.VideoSourceToken,VendorId=model.VendorId,ModelId=model.Id}).ToArray();
            var store=new Store(Path.Combine(AppContext.BaseDirectory,"dahua-test",Guid.NewGuid().ToString("N")));
            var imported=EquipmentCatalog.ImportProfiles(store,cameras); var id=imported[0].Id;
            EquipmentCatalog.ImportProfiles(store,cameras); var restored=new Store(store.Root);
            Check(restored.Data.Equipment.Single().Connector=="DahuaHTTP" && restored.Data.Cameras.Count==4 && restored.Data.Cameras[0].Id==id && restored.Data.Cameras.All(c=>c.OnvifAddress=="" && c.DeviceAddress==address+"/"),"CGI equipment survives rediscovery/restart without ONVIF misclassification or duplicate profiles");
            using var sender=new RtspFixture();
            using var hub=new WebFrameHub(engine); byte[]? frame=null; var deadline=DateTime.UtcNow.AddSeconds(20);
            while(DateTime.UtcNow<deadline && frame is null) {frame=hub.Frame(imported[0]);await Task.Delay(250);}
            Check(frame is {Length:>1000} && frame[0]==0xff && frame[1]==0xd8,"CGI-discovered RTSP URL yields decoded video through production frame hub");
        }
        catch(Exception e){results.Add("FAIL "+e);Environment.ExitCode=1;}
        finally {await server.StopAsync();File.WriteAllLines(Path.Combine(AppContext.BaseDirectory,"dahua-driver-test.txt"),results);File.WriteAllLines(Path.Combine(AppContext.BaseDirectory,"dahua-driver-requests.txt"),requests);File.WriteAllLines(Path.Combine(AppContext.BaseDirectory,"dahua-driver-media.log"),log);}
    }
}

