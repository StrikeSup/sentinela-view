using System.Net;
using System.Net.Http.Json;
using LibVLCSharp.Shared;

namespace IndependentCenter;
static class WebServerTest
{
    public static async Task Run(LibVLC engine, bool preview = false)
    {
        var report = new List<string>();
        void Check(bool success, string name) { if (!success) throw new Exception(name); report.Add("PASS " + name); }
        try
        {
            var account = new Account { Name = "demo", Role = "Visualizador" }; account.SetPassword(TestCredentials.Password);
            var camera = new Camera { Name = "Vídeo de teste", EquipmentId = Guid.NewGuid(), ChannelToken = "source-1", Group = "Demonstração", Source = Path.Combine(AppContext.BaseDirectory, "demo.mp4"), User = "", Notes = "not-public" };
            if (!File.Exists(camera.Source)) throw new FileNotFoundException(camera.Source);
            var accounts = new[] { account }; var cameras = new[] { camera };
            bool stalledCatalog = false;
            var stalled = new TaskCompletionSource<WebCatalog>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var server = new CenterWebServer(engine, () => stalledCatalog ? stalled.Task : Task.FromResult(new WebCatalog(cameras, accounts)), preview ? 8096 : 18095);
            await server.StartAsync();
            using var http = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() }) { BaseAddress = new Uri(server.Address), Timeout = TimeSpan.FromSeconds(10) };
            Check((await http.GetAsync("/api/cameras")).StatusCode == HttpStatusCode.Unauthorized, "camera catalog requires authentication");
            Check((await http.GetAsync("/api/vendors")).StatusCode == HttpStatusCode.Unauthorized, "vendor catalog requires authentication");
            Check((await http.PostAsync($"/api/cameras/{camera.Id}/whep", new StringContent("v=0", System.Text.Encoding.UTF8,"application/sdp"))).StatusCode == HttpStatusCode.Unauthorized, "WebRTC requires authentication before opening relay");
            Check((await http.GetAsync($"/api/cameras/{camera.Id}/image.jpg")).StatusCode == HttpStatusCode.Unauthorized && server.ActiveStreams == 0, "unauthenticated image cannot start a decoder");
            var html = await http.GetAsync("/"); Check(html.IsSuccessStatusCode && (await html.Content.ReadAsStringAsync()).Contains("Center Web"), "embedded web page served");
            Check((await http.GetAsync("/app.js")).IsSuccessStatusCode && (await http.GetAsync("/style.css")).IsSuccessStatusCode, "web assets served");
            using (var foreign = new HttpRequestMessage(HttpMethod.Post, "/api/login") { Content = JsonContent.Create(new { username = "demo", password = TestCredentials.Password }) })
            { foreign.Headers.Add("Origin", "http://foreign.invalid"); Check((await http.SendAsync(foreign)).StatusCode == HttpStatusCode.Forbidden, "foreign origin rejected"); }
            using (var rebound = new HttpRequestMessage(HttpMethod.Get, "/"))
            { rebound.Headers.Host = "foreign.invalid"; Check((await http.SendAsync(rebound)).StatusCode == HttpStatusCode.Forbidden, "foreign Host rejected"); }
            Check((await http.PostAsJsonAsync("/api/login", new { username = "demo", password = "wrong" })).StatusCode == HttpStatusCode.Unauthorized, "incorrect password rejected");
            Check((await http.PostAsJsonAsync("/api/login", new { username = "demo", password = "wrong" })).StatusCode == (HttpStatusCode)429, "login backoff enforced");
            await Task.Delay(2200);
            var login = await http.PostAsJsonAsync("/api/login", new { username = "demo", password = TestCredentials.Password });
            Check(login.IsSuccessStatusCode && login.Headers.GetValues("Set-Cookie").Any(x => x.Contains("httponly", StringComparison.OrdinalIgnoreCase) && x.Contains("samesite=strict", StringComparison.OrdinalIgnoreCase)), "valid password grants protected cookie");
            var list = await http.GetStringAsync("/api/cameras");
            using (var vendors = System.Text.Json.JsonDocument.Parse(await http.GetStringAsync("/api/vendors")))
                Check(vendors.RootElement.GetProperty("vendors").GetArrayLength() == 385, "web exposes all 385 catalog entries");
            var intelbras = DeviceCatalog.Vendors.First(v=>v.Name == "Intelbras");
            using (var models = System.Text.Json.JsonDocument.Parse(await http.GetStringAsync($"/api/vendors/{intelbras.Id}/models")))
                Check(models.RootElement.GetProperty("models").GetArrayLength() == 500 && models.RootElement.GetProperty("models")[0].TryGetProperty("onvifDiscovery", out _), "web exposes real models and explicit connector availability");
            Check((await http.GetAsync($"/api/vendors/{Guid.NewGuid()}/models")).StatusCode == HttpStatusCode.NotFound, "unknown vendor returns 404");
            Check(list.Contains(camera.Id.ToString()) && !list.Contains(camera.Source) && !list.Contains("ProtectedPassword") && !list.Contains("not-public"), "catalog returns camera without source or secrets");
            Check(list.Contains(camera.EquipmentId.ToString()!) && list.Contains("source-1"), "web metadata preserves equipment and channel identity");
            Check((await http.GetAsync($"/api/cameras/{Guid.NewGuid()}/image.jpg")).StatusCode == HttpStatusCode.NotFound, "unknown camera returns 404");
            byte[]? image = null; var deadline = DateTime.UtcNow.AddSeconds(20);
            while (DateTime.UtcNow < deadline)
            {
                var response = await http.GetAsync($"/api/cameras/{camera.Id}/image.jpg");
                if (response.IsSuccessStatusCode) { image = await response.Content.ReadAsByteArrayAsync(); Check(response.Content.Headers.ContentType?.MediaType == "image/jpeg", "image content type"); break; }
                Check(response.StatusCode == HttpStatusCode.ServiceUnavailable, "warming decoder returns 503 instead of fake image"); await Task.Delay(500);
            }
            Check(image is { Length: > 1000 } && image[0] == 0xff && image[1] == 0xd8, "real LibVLC decoded JPEG over authenticated HTTP");
            using (var decoded = Image.FromStream(new MemoryStream(image!))) Check(decoded.Width == 1280 && decoded.Height == 720, "JPEG dimensions validated");
            await http.GetAsync($"/api/cameras/{camera.Id}/image.jpg");
            Check(server.ActiveStreams == 1, "repeated web viewers reuse one decoder");
            using (var other = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() }) { BaseAddress = http.BaseAddress })
            {
                await other.PostAsJsonAsync("/api/login", new { username = "demo", password = TestCredentials.Password });
                var simultaneous = await Task.WhenAll(http.GetAsync($"/api/cameras/{camera.Id}/image.jpg"), other.GetAsync($"/api/cameras/{camera.Id}/image.jpg"));
                Check(simultaneous.All(r => r.IsSuccessStatusCode) && server.ActiveStreams == 1, "two independent authenticated clients share decoder");
            }
            await Task.Delay(1100);
            var changedFrame = await http.GetByteArrayAsync($"/api/cameras/{camera.Id}/image.jpg");
            Check(!image!.SequenceEqual(changedFrame), "video frames advance rather than serving static preview");
            if (!preview)
            {
                int received = 0; var until = DateTime.UtcNow.AddSeconds(35);
                while (DateTime.UtcNow < until)
                { if ((await http.GetAsync($"/api/cameras/{camera.Id}/image.jpg")).IsSuccessStatusCode) received++; await Task.Delay(500); }
                Check(received >= 55, "continuous acquisition survives local video end and restart");
            }
            account.SetPassword(TestCredentials.OtherPassword);
            Check((await http.GetAsync("/api/cameras")).StatusCode == HttpStatusCode.Unauthorized, "password change revokes session");
            account.SetPassword(TestCredentials.Password);
            await http.PostAsJsonAsync("/api/login", new { username = "demo", password = TestCredentials.Password });
            Check((await http.PostAsync("/api/logout", null)).StatusCode == HttpStatusCode.NoContent && (await http.GetAsync("/api/cameras")).StatusCode == HttpStatusCode.Unauthorized, "logout invalidates session");
            File.WriteAllBytes(Path.Combine(AppContext.BaseDirectory, "web-test-frame.jpg"), image!);
            if (!preview)
            {
                await http.PostAsJsonAsync("/api/login", new { username = "demo", password = TestCredentials.Password });
                cameras = Enumerable.Range(0, 5).Select(i => i == 0 ? camera : new Camera { Name = "Capacity " + i, Source = camera.Source }).ToArray();
                foreach (var additional in cameras.Skip(1).Take(3)) await http.GetAsync($"/api/cameras/{additional.Id}/image.jpg");
                var full = await http.GetAsync($"/api/cameras/{cameras[4].Id}/image.jpg");
                Check(full.StatusCode == HttpStatusCode.ServiceUnavailable && server.ActiveStreams == 4, "decoder capacity enforced across cameras");
                cameras = [];
                Check((await http.GetAsync($"/api/cameras/{camera.Id}/image.jpg")).StatusCode == HttpStatusCode.NotFound, "deleted camera no longer accessible");
                await Task.Delay(TimeSpan.FromSeconds(36));
                Check(server.ActiveStreams == 0, "idle decoders released after viewers stop requesting");
                stalledCatalog = true;
                var pending = http.GetAsync("/api/cameras"); await Task.Delay(200);
                var stopped = System.Diagnostics.Stopwatch.StartNew(); server.Dispose();
                Check(stopped.Elapsed < TimeSpan.FromSeconds(4), "shutdown cancels pending catalog request without UI deadlock");
                try { await pending; } catch (HttpRequestException) { }
            }
            if (preview) { File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "web-preview-ready.txt"), server.Address); await Task.Delay(TimeSpan.FromMinutes(6)); }
        }
        catch (Exception e) { report.Add(e.ToString()); Environment.ExitCode = 1; }
        File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, preview ? "web-preview-test.txt" : "web-test.txt"), report);
    }
}


