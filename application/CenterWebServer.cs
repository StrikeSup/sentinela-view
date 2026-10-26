using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Hosting;
using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace IndependentCenter;

public sealed record WebCatalog(Camera[] Cameras, Account[] Accounts);
public sealed class CenterWebServer : IDisposable
{
    readonly WebApplication app;
    readonly WebFrameHub frames;
    readonly LocalWebRtc rtc = new();
    readonly PlaybackDiagnostics diagnostics=new();
    readonly Func<Task<WebCatalog>> catalog;
    readonly ConcurrentDictionary<string, Session> sessions = new();
    readonly SemaphoreSlim loginGate = new(1, 1);
    DateTime blockedUntil;
    int failures;
    int disposed;
    public string Address { get; }
    public int ActiveStreams => frames.ActiveCount;
    const string CookieName = "CenterSession";
    sealed record Session(string Name, string Hash, DateTime Expires);
    sealed record LoginInput(string? Username, string? Password);
    public CenterWebServer(LibVLCSharp.Shared.LibVLC engine, Func<Task<WebCatalog>> catalog, int port = 8095, WebEquipment? equipment = null, LocalServerLicenses? licenses = null, string? frontend = null)
    {
        if (port < 1024 || port > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        this.catalog = catalog; frames = new(engine); Address = $"http://127.0.0.1:{port}";
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(o => { o.Listen(IPAddress.Loopback, port); o.Limits.MaxRequestBodySize = 65536; o.Limits.MaxConcurrentConnections = 32; });
        app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; form-action 'self'";
            if (context.Request.Host.Value != $"127.0.0.1:{port}") { context.Response.StatusCode = 403; return; }
            var origin = context.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && origin != Address) { context.Response.StatusCode = 403; return; }
            if(frontend is not null){
                context.Response.Headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'";
                if(context.Request.Path.StartsWithSegments("/center-api",out var remaining))context.Request.Path="/api"+remaining;
            }
            try { await next(context); }
            catch (BadHttpRequestException) { if (!context.Response.HasStarted) context.Response.StatusCode = 400; }
            catch (OperationCanceledException) { }
            catch (Exception) { if (!context.Response.HasStarted) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { error = "Serviço temporariamente indisponível." }); } }
        });
        app.UseRouting();
        IResult FrontFile(string relative){
            var root=Path.GetFullPath(frontend!)+Path.DirectorySeparatorChar;var file=Path.GetFullPath(Path.Combine(root,relative));
            if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase)||!File.Exists(file))return Results.NotFound();
            var provider=new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();provider.TryGetContentType(file,out var type);
            return Results.File(file,type??"application/octet-stream");
        }
        if(frontend is not null){
            app.MapGet("/assets/{**path}",(string path)=>FrontFile("assets/"+path));
            app.MapFallback((HttpContext ctx)=>ctx.Request.Path.StartsWithSegments("/api")?Results.NotFound():FrontFile("index.html"));
        }
        app.MapGet("/", () => frontend is null?Asset("index.html", "text/html; charset=utf-8"):FrontFile("index.html"));
        app.MapGet("/app.js", () => Asset("app.js", "text/javascript; charset=utf-8"));
        app.MapGet("/style.css", () => Asset("style.css", "text/css; charset=utf-8"));
        app.MapPost("/api/login", (Func<HttpContext, Task<IResult>>)Login);
        app.MapGet("/api/local-servers",async(HttpContext ctx)=>{
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            return licenses is null?Results.StatusCode(501):Results.Ok(licenses.Servers());
        });
        app.MapGet("/api/local-licenses",async(HttpContext ctx)=>{
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            if(data.Accounts.Single(a=>a.Name==sessions[ctx.Request.Cookies[CookieName]!].Name).Role!="Administrador")return Results.StatusCode(403);
            return licenses is null?Results.StatusCode(501):Results.Ok(licenses.History());
        });
        async Task<IResult> WriteLocalServer(HttpContext ctx){
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            if(data.Accounts.Single(a=>a.Name==sessions[ctx.Request.Cookies[CookieName]!].Name).Role!="Administrador")return Results.StatusCode(403);
            if(licenses is null)return Results.StatusCode(501);
            try{
                if(ctx.Request.RouteValues["id"] is string id)return Results.Ok(licenses.Bind(id));
                if(!ctx.Request.HasJsonContentType())return Results.StatusCode(415);
                var input=await System.Text.Json.Nodes.JsonNode.ParseAsync(ctx.Request.Body,cancellationToken:ctx.RequestAborted) as System.Text.Json.Nodes.JsonObject;
                return input is null?Results.BadRequest():Results.Json(licenses.Create(input),statusCode:201);
            }catch(ArgumentException e){return Results.BadRequest(new{error=e.Message});}catch(InvalidOperationException e){return Results.Conflict(new{error=e.Message});}catch(JsonException){return Results.BadRequest();}
        }
        app.MapPost("/api/local-servers",(Func<HttpContext,Task<IResult>>)WriteLocalServer);
        app.MapPost("/api/local-servers/{id:guid}/bind",(Func<HttpContext,Task<IResult>>)WriteLocalServer);
        app.MapGet("/api/equipment", async (HttpContext ctx) => {
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            return Results.Ok(WebEquipmentMetadata.Rows(data.Cameras));
        });
        app.MapGet("/api/equipment/connections",async(HttpContext ctx)=>{
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);timeout.CancelAfter(TimeSpan.FromSeconds(5));
            return Results.Ok(await rtc.Connections(timeout.Token));
        });
        async Task<IResult> SaveEquipment(HttpContext ctx) {
            var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
            var session=sessions[ctx.Request.Cookies[CookieName]!];
            if(!data.Accounts.Any(a=>a.Name==session.Name&&a.Role=="Administrador"))return Results.StatusCode(403);
            if(equipment is null)return Results.StatusCode(501);
            if(!ctx.Request.HasJsonContentType())return Results.StatusCode(415);
            try {
                var input=await System.Text.Json.Nodes.JsonNode.ParseAsync(ctx.Request.Body,cancellationToken:ctx.RequestAborted) as System.Text.Json.Nodes.JsonObject;
                if(input is null)return Results.BadRequest();
                if(ctx.Request.Method=="PUT"){
                    if(!Guid.TryParse(ctx.Request.RouteValues["id"]?.ToString(),out var id))return Results.BadRequest();
                    var previous=data.Cameras.Where(c=>(c.EquipmentId??c.Id)==id).ToArray();
                    if(previous.Length==0)return Results.NotFound();
                    return Results.Ok(await equipment.Update(input,previous,ctx.RequestAborted));
                }
                return Results.Json(await equipment.Create(input,ctx.RequestAborted),statusCode:201);
            } catch(ArgumentException e){return Results.BadRequest(new{error=e.Message});}
              catch(JsonException){return Results.BadRequest(new{error="Cadastro inválido."});}
              catch(InvalidOperationException){return Results.BadRequest(new{error="Cadastro duplicado, em andamento ou campos inválidos."});}
              catch(UnauthorizedAccessException){return Results.BadRequest(new{error="O equipamento recusou as credenciais."});}
              catch(Exception e)when(e is IOException or HttpRequestException or OperationCanceledException){return Results.Json(new{error="Não foi possível consultar os canais. Verifique endereço, portas, credenciais e disponibilidade do equipamento. Nenhum cadastro foi salvo."},statusCode:502);}
        }
        app.MapPost("/api/equipment",(Func<HttpContext,Task<IResult>>)SaveEquipment);
        app.MapPut("/api/equipment/{id:guid}",(Func<HttpContext,Task<IResult>>)SaveEquipment);
        app.MapGet("/api/me", async (HttpContext ctx) => {
            var data=await catalog().WaitAsync(TimeSpan.FromSeconds(5),ctx.RequestAborted);
            if(!Authorized(ctx,data))return Results.Unauthorized();
            var session=sessions[ctx.Request.Cookies[CookieName]!];
            var account=data.Accounts.Single(a=>a.Name==session.Name);
            return Results.Ok(new{username=account.Name,role=account.Role,expires=session.Expires});
        });
        app.MapPost("/api/logout", (HttpContext ctx) => { if (ctx.Request.Cookies.TryGetValue(CookieName, out var token)) sessions.TryRemove(token, out _); ctx.Response.Cookies.Delete(CookieName, new() { Path = "/" }); return Results.NoContent(); });
        app.MapGet("/api/cameras", async (HttpContext ctx) =>
        {
            var data = await catalog().WaitAsync(TimeSpan.FromSeconds(5), ctx.RequestAborted);
            if (!Authorized(ctx, data)) return Results.Unauthorized();
            return Results.Ok(new { cameras = data.Cameras.Select(c => new { id = c.Id, equipmentId = c.EquipmentId, channelToken = c.ChannelToken, name = c.Name, group = c.Group, connector = c.DeviceConnector.Length > 0 ? c.DeviceConnector : c.OnvifAddress.Length > 0 ? "ONVIF" : "Genérico" }), maxStreams = WebFrameHub.Capacity, maxWebRtcStreams = (int?)null });
        });
        app.MapGet("/api/diagnostics/playback",async(HttpContext ctx)=>{
 var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
 using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);timeout.CancelAfter(TimeSpan.FromSeconds(2));
 return Results.Ok(new{playback=diagnostics.Snapshot(ctx.Request.Cookies[CookieName]!),relay=await rtc.Diagnostics(timeout.Token)});
});
app.MapPost("/api/diagnostics/playback/{id:guid}",async(Guid id,HttpContext ctx)=>{
 var data=await catalog();if(!Authorized(ctx,data))return Results.Unauthorized();
 var sample=await ctx.Request.ReadFromJsonAsync<PlaybackDiagnostics.ClientSample>();
 return sample is not null&&diagnostics.Report(id,ctx.Request.Cookies[CookieName]!,sample)?Results.NoContent():Results.BadRequest();
});
app.MapPost("/api/cameras/{id:guid}/whep", async (Guid id,HttpContext ctx) => {
            var data=await catalog().WaitAsync(TimeSpan.FromSeconds(5),ctx.RequestAborted);
            if(!Authorized(ctx,data))return Results.Unauthorized();
            var camera=data.Cameras.FirstOrDefault(c=>c.Id==id);if(camera is null)return Results.NotFound();
            if(ctx.Request.ContentType?.Split(';')[0]!="application/sdp")return Results.StatusCode(415);
            using var reader=new StreamReader(ctx.Request.Body);
            var offer=await reader.ReadToEndAsync(ctx.RequestAborted);
            if(!offer.StartsWith("v=0"))return Results.BadRequest();
            try {
                var trace=diagnostics.Begin(id,ctx.Request.Cookies[CookieName]!);
                ctx.Response.Headers["X-Diagnostic-Id"]=trace.ToString();
                var result=await rtc.Offer(camera,ctx.Request.Cookies[CookieName]!,offer,ctx.RequestAborted,mark:stage=>diagnostics.Mark(trace,stage));
                diagnostics.Mark(trace,"answer-returned");
                ctx.Response.Headers.Location=$"/api/webrtc/{result.Id}";
                return Results.Text(result.Answer,"application/sdp",statusCode:201);
            }catch(Exception e)when(e is IOException or InvalidOperationException){return Results.Json(new{error=e.Message},statusCode:503);}
        });
        app.MapDelete("/api/webrtc/{id:guid}",async(Guid id,HttpContext ctx)=>{
            var data=await catalog().WaitAsync(TimeSpan.FromSeconds(5),ctx.RequestAborted);
            if(!Authorized(ctx,data))return Results.Unauthorized();
            return await rtc.Close(id,ctx.Request.Cookies[CookieName]!,ctx.RequestAborted)?Results.NoContent():Results.NotFound();
        });
        app.MapGet("/api/vendors", async (HttpContext ctx) =>
        {
            var data = await catalog().WaitAsync(TimeSpan.FromSeconds(5), ctx.RequestAborted);
            if (!Authorized(ctx, data)) return Results.Unauthorized();
            return Results.Ok(new { vendors = DeviceCatalog.Vendors.Select(v => new { guid = v.Id, name = v.Name, modelCount = v.Models.Length }) });
        });
        app.MapGet("/api/vendors/{vendorId:guid}/models", async (Guid vendorId, HttpContext ctx) =>
        {
            var data = await catalog().WaitAsync(TimeSpan.FromSeconds(5), ctx.RequestAborted);
            if (!Authorized(ctx, data)) return Results.Unauthorized();
            var vendor = DeviceCatalog.Vendors.FirstOrDefault(v => v.Id == vendorId);
            if (vendor is null) return Results.NotFound();
            return Results.Ok(new { models = vendor.Models.Select(m => new { guid=m.Id, name=m.Name, connector=m.Connector, onvifDiscovery=m.OnvifDiscovery, dahuaDiscovery=m.DahuaDiscovery, status=m.Status, capabilities=m.Original }) });
        });
        app.MapGet("/api/cameras/{id:guid}/image.jpg", async (Guid id, HttpContext ctx) =>
        {
            var data = await catalog().WaitAsync(TimeSpan.FromSeconds(5), ctx.RequestAborted);
            if (!Authorized(ctx, data)) return Results.Unauthorized();
            var camera = data.Cameras.FirstOrDefault(c => c.Id == id); if (camera is null) return Results.NotFound();
            try
            {
                var frame = frames.Frame(camera);
                if (frame is not null) return Results.Bytes(frame, "image/jpeg");
                ctx.Response.Headers.RetryAfter = "1"; return Results.Json(new { error = "Conectando ou aguardando imagem do equipamento.", state = frames.Status(id) }, statusCode: 503);
            }
            catch (InvalidOperationException e) { return Results.Json(new { error = e.Message }, statusCode: 503); }
        });
    }
    static IResult Asset(string name, string contentType)
    {
        using var stream = typeof(CenterWebServer).Assembly.GetManifestResourceStream("Center.Web." + name) ?? throw new FileNotFoundException(name);
        using var copy = new MemoryStream(); stream.CopyTo(copy); return Results.Bytes(copy.ToArray(), contentType);
    }
    bool Authorized(HttpContext ctx, WebCatalog data)
    {
        if (!ctx.Request.Cookies.TryGetValue(CookieName, out var token) || !sessions.TryGetValue(token, out var session)) return false;
        if (session.Expires > DateTime.UtcNow && data.Accounts.Any(a => a.Name == session.Name && a.Hash == session.Hash)) return true;
        sessions.TryRemove(token, out _); return false;
    }
    async Task<IResult> Login(HttpContext ctx)
    {
        if (!ctx.Request.HasJsonContentType()) return Results.StatusCode(415);
        LoginInput? input;
        try { input = await JsonSerializer.DeserializeAsync<LoginInput>(ctx.Request.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web), ctx.RequestAborted); }
        catch (JsonException) { return Results.BadRequest(); }
        if (input?.Username is null || input.Password is null || input.Username.Length > 100 || input.Password.Length > 1024) return Results.BadRequest();
        if (!await loginGate.WaitAsync(0)) return Results.StatusCode(429);
        try
        {
            if (DateTime.UtcNow < blockedUntil) return Results.StatusCode(429);
            var data = await catalog().WaitAsync(TimeSpan.FromSeconds(5), ctx.RequestAborted);
            var user = data.Accounts.FirstOrDefault(a => a.Name.Equals(input.Username.Trim(), StringComparison.OrdinalIgnoreCase));
            if (user is null || user.Hash.Length == 0 || !user.Verify(input.Password))
            { blockedUntil = DateTime.UtcNow.AddSeconds(Math.Min(30, ++failures * 2)); return Results.Unauthorized(); }
            failures = 0;
            foreach (var pair in sessions.Where(p => p.Value.Expires <= DateTime.UtcNow)) sessions.TryRemove(pair.Key, out _);
            if (sessions.Count >= 32) return Results.StatusCode(429);
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            sessions[token] = new(user.Name, user.Hash, DateTime.UtcNow.AddMinutes(15));
            ctx.Response.Cookies.Append(CookieName, token, new() { HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromMinutes(15), IsEssential = true });
            return Results.Ok(new { username = user.Name, expiresInSeconds = 900 });
        }
        finally { loginGate.Release(); }
    }
    public Task StartAsync() => app.StartAsync();
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        try { app.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        finally { rtc.Dispose(); frames.Dispose(); app.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
    }
}



