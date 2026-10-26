using LibVLCSharp.Shared;
using Microsoft.Web.WebView2.WinForms;
using System.Text.Json;

namespace IndependentCenter;

// Trusted loopback document sends geometry and catalog IDs only, never URLs or credentials.
sealed class GuardianNativeBridge : IDisposable
{
    readonly Form owner; readonly WebView2 web; readonly LibVLC engine;
    readonly Func<Task<WebCatalog>> catalog; readonly string address;
    readonly Dictionary<string,NativeVideoTile> tiles=[];
    readonly HttpClient http=new(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromSeconds(3)};
    readonly System.Windows.Forms.Timer timer=new(){Interval=250};
    Layout? pending; DateTime received,checkedAt,reportedAt; bool busy,disposed,authorized;
    string session="";
    string hovered="";
    WebCatalog? cached; DateTime catalogAt; readonly List<Task> retiring=[];
    readonly List<NativeVideoTile> retiredTiles=[];
    DateTime measuredAt,lastTick;double maxTickGap;long geometryChanges;
    public GuardianNativeBridge(Form owner,WebView2 web,LibVLC engine,Func<Task<WebCatalog>> catalog,string address)
    {
        this.owner=owner;this.web=web;this.engine=engine;this.catalog=catalog;this.address=address;
        web.CoreWebView2.WebMessageReceived+=(_,e)=>{
            if(!Uri.TryCreate(e.Source,UriKind.Absolute,out var uri)||uri.GetLeftPart(UriPartial.Authority)!=address)return;
            try{if(e.WebMessageAsJson.Length>65536)return;
                var layout=JsonSerializer.Deserialize<Layout>(e.WebMessageAsJson,options);
                if(layout?.Type!="native-layout"||layout.Slots is null||layout.Slots.Length>100||!double.IsFinite(layout.ViewportWidth)||!double.IsFinite(layout.ViewportHeight)||layout.ViewportWidth<=0||layout.ViewportHeight<=0||!double.IsFinite(layout.PixelRatio)||layout.PixelRatio<=0||layout.PixelRatio>8)return;
                pending=layout;received=DateTime.UtcNow;
            }catch(JsonException){}
        };
        web.CoreWebView2.NavigationStarting+=(_,_)=>{pending=null;Clear();};
        timer.Tick+=async(_,_)=>await Update();timer.Start();
    }
    static readonly JsonSerializerOptions options=new(){PropertyNameCaseInsensitive=true};
    async Task Update()
    {
        var now=DateTime.UtcNow;if(lastTick!=default)maxTickGap=Math.Max(maxTickGap,(now-lastTick).TotalMilliseconds);lastTick=now;
        if(disposed||busy)return;busy=true;
        try{
            if(DateTime.UtcNow-checkedAt>TimeSpan.FromSeconds(1)){
                var cookies=await web.CoreWebView2.CookieManager.GetCookiesAsync(address);
                var token=cookies.FirstOrDefault(c=>c.Name=="CenterSession")?.Value??"";
                if(session!=token){Clear();session=token;}
                using var request=new HttpRequestMessage(HttpMethod.Get,address+"/api/me");
                if(token.Length>0)request.Headers.Add("Cookie","CenterSession="+token);
                using var response=await http.SendAsync(request);authorized=response.IsSuccessStatusCode;checkedAt=DateTime.UtcNow;
            }
            if(disposed)return;
            if(!authorized){Clear();return;}
            var layout=pending;
            if(layout is null||DateTime.UtcNow-received>TimeSpan.FromSeconds(2)){foreach(var t in tiles.Values)t.Visible=false;return;}
            // Reject a queued layout from before a resize/DPI change.
            if(Math.Abs(layout.ViewportWidth*layout.PixelRatio-web.ClientSize.Width)>4||Math.Abs(layout.ViewportHeight*layout.PixelRatio-web.ClientSize.Height)>4){foreach(var t in tiles.Values)t.Visible=false;return;}
            if(cached is null||DateTime.UtcNow-catalogAt>TimeSpan.FromSeconds(5)){cached=await Task.Run(catalog);catalogAt=DateTime.UtcNow;}
            var data=cached;if(disposed)return;
            var wanted=layout.Slots.Select(s=>s.Key).ToHashSet();
            foreach(var key in tiles.Keys.Where(k=>!wanted.Contains(k)).ToArray()){var old=tiles[key];tiles.Remove(key);Retire(old);}
            foreach(var slot in layout.Slots){
                if(slot is null||string.IsNullOrEmpty(slot.Key)||slot.Key.Length>80||!Guid.TryParse(slot.Camera,out var id))continue;
                var camera=data.Cameras.FirstOrDefault(c=>c.Id==id);if(camera is null)continue;
                if(tiles.TryGetValue(slot.Key,out var prior)&&(prior.CameraId!=id||prior.Quality!=slot.Quality)){tiles.Remove(slot.Key);Retire(prior);}
                if(!tiles.TryGetValue(slot.Key,out var tile)){
                    tile=new NativeVideoTile(engine,camera,slot.Quality){Visible=false};tile.HideChrome();tiles.Add(slot.Key,tile);owner.Controls.Add(tile);
                    tile.SurfacePointer+=kind=>{if(!disposed)web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="native-pointer",key=slot.Key,kind}));};
                }
                bool visible=slot.Visible&&owner.Visible&&owner.WindowState!=FormWindowState.Minimized&&slot.Width>0&&slot.Height>0&&slot.X+slot.Width>0&&slot.Y+slot.Height>0&&slot.X<layout.ViewportWidth&&slot.Y<layout.ViewportHeight;
                var wasVisible=tile.Visible;
                if(visible){double scale=layout.PixelRatio;
                    var bounds=new Rectangle(web.Left+(int)Math.Round(slot.X*scale),web.Top+(int)Math.Round(slot.Y*scale),(int)Math.Round(slot.Width*scale),(int)Math.Round(slot.Height*scale));
                    if(tile.Bounds!=bounds){tile.Bounds=bounds;geometryChanges++;}
                     tile.SetPresentation(slot.Contain);
 var holes=(layout.Cutouts??[]).Where(r=>double.IsFinite(r.X)&&double.IsFinite(r.Y)&&double.IsFinite(r.Width)&&double.IsFinite(r.Height)&&r.Width>0&&r.Height>0&&r.Height<100).Take(300).Select(r=>Rectangle.Intersect(new Rectangle(0,0,bounds.Width,bounds.Height),new Rectangle((int)Math.Round((r.X-slot.X)*scale),(int)Math.Round((r.Y-slot.Y)*scale),(int)Math.Ceiling(r.Width*scale),(int)Math.Ceiling(r.Height*scale)))).Where(r=>r.Width>0&&r.Height>0).ToArray();
 tile.SetCutouts(holes);
 if(!wasVisible){tile.Visible=true;tile.BringToFront();}
                    if(!tile.HasStarted)tile.Start();
                }else if(wasVisible)tile.Visible=false;
                if(tile.HasStarted)tile.Check();
            }
            var pointer=owner.PointToClient(Cursor.Position);
            var hover=tiles.FirstOrDefault(p=>p.Value.Visible&&p.Value.Bounds.Contains(pointer)).Key??"";
            if(hover!=hovered){hovered=hover;web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="native-hover",key=hover}));}
            if(DateTime.UtcNow-reportedAt>TimeSpan.FromSeconds(1)){
                web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="native-status",slots=tiles.Select(p=>new{key=p.Key,fresh=p.Value.Fresh})}));reportedAt=DateTime.UtcNow;
            }
            if(DateTime.UtcNow-measuredAt>TimeSpan.FromSeconds(5)){
                var report=JsonSerializer.Serialize(new{at=DateTimeOffset.Now,players=tiles.Count,visible=tiles.Values.Count(t=>t.Visible),fresh=tiles.Values.Count(t=>t.Fresh),maxTickGapMs=Math.Round(maxTickGap),geometryChanges,frames=tiles.Values.Select(t=>t.Diagnostics())});
                PlaybackDiagnostics.NativeSnapshot=JsonSerializer.Deserialize<JsonElement>(report);
                measuredAt=DateTime.UtcNow;maxTickGap=0;geometryChanges=0;
                try{await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory,"native-bridge-status.json"),report);}catch(IOException){}catch(UnauthorizedAccessException){}
            }
        }catch(Exception e)when(e is HttpRequestException or TaskCanceledException or InvalidOperationException or ObjectDisposedException){authorized=false;Clear();}
        finally{busy=false;}
    }
    void Retire(NativeVideoTile tile){tile.Visible=false;owner.Controls.Remove(tile);retiring.RemoveAll(t=>t.IsCompleted);retiredTiles.RemoveAll(t=>t.IsDisposed);retiredTiles.Add(tile);retiring.Add(tile.RetireAsync());}
    void Clear(){foreach(var t in tiles.Values)Retire(t);tiles.Clear();cached=null;}
    public void Dispose(){disposed=true;timer.Dispose();Clear();foreach(var tile in retiredTiles)tile.Dispose();retiredTiles.Clear();http.Dispose();}
    sealed class Layout{public string Type{get;set;}="";public double ViewportWidth{get;set;}public double ViewportHeight{get;set;}public double PixelRatio{get;set;}public Cutout[] Cutouts{get;set;}=[];public Slot[] Slots{get;set;}=[];}
    sealed class Cutout{public double X{get;set;}public double Y{get;set;}public double Width{get;set;}public double Height{get;set;}}
    sealed class Slot{public string Quality{get;set;}="principal";public bool Contain{get;set;}public string Key{get;set;}="";public string Camera{get;set;}="";public double X{get;set;}public double Y{get;set;}public double Width{get;set;}public double Height{get;set;}public bool Visible{get;set;}}
}



