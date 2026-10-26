using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
namespace IndependentCenter;
static class WebEquipmentTest
{
 public static async Task Run(LibVLCSharp.Shared.LibVLC engine,string device,Action<bool,string> check){
  var root=Path.Combine(AppContext.BaseDirectory,"registration-tests",Guid.NewGuid().ToString("N"));
  var store=new WebEquipment(root);var admin=new Account{Name="fixture-admin",Role="Administrador"};admin.SetPassword(TestCredentials.Password);
  var viewer=new Account{Name="fixture-viewer",Role="Visualizador"};viewer.SetPassword(TestCredentials.Password);
  Camera[] legacyCameras=[];
  var licenseStore=new LocalServerLicenses(Path.Combine(root,"licenses"));
  using var server=new CenterWebServer(engine,()=>Task.FromResult(new WebCatalog(legacyCameras.Concat(store.Cameras()).GroupBy(c=>c.Id).Select(g=>g.Last()).ToArray(),[admin,viewer])),18096,store,licenseStore);await server.StartAsync();
  using var http=new HttpClient(new HttpClientHandler{CookieContainer=new()}){BaseAddress=new(server.Address)};
  JsonObject Input()=>new(){["nome"]="DVR fixture",["fabricante"]="Dahua",["usuario"]="operator",["senha"]="test-password",["ip_interno"]="127.0.0.1",["porta_http_interna"]=new Uri(device).Port};
  check((await http.PostAsJsonAsync("/api/equipment",Input())).StatusCode==HttpStatusCode.Unauthorized,"registration requires login");
  await http.PostAsJsonAsync("/api/login",new{username=viewer.Name,password=TestCredentials.Password});
  check((await http.PostAsJsonAsync("/api/equipment",Input())).StatusCode==HttpStatusCode.Forbidden,"viewer cannot register equipment");
  await http.PostAsJsonAsync("/api/login",new{username=admin.Name,password=TestCredentials.Password});
  var bad=Input();bad["senha"]="wrong";
  check((await http.PostAsJsonAsync("/api/equipment",bad)).StatusCode==HttpStatusCode.BadRequest,"invalid device credentials rejected");
  check(store.Cameras().Length==0,"failed discovery does not persist cameras");
  bad=Input();bad["prioridade_conexao"]=new JsonArray("interno","interno","cloud");
  check((await http.PostAsJsonAsync("/api/equipment",bad)).StatusCode==HttpStatusCode.BadRequest,"invalid connection order rejected");
  using(var request=new HttpRequestMessage(HttpMethod.Post,"/api/equipment"){Content=JsonContent.Create(Input())}){request.Headers.Add("Origin","http://foreign.invalid");check((await http.SendAsync(request)).StatusCode==HttpStatusCode.Forbidden,"foreign-origin registration rejected");}
  var ordered=Input();ordered["porta_http_interna"]=1;ordered["ip_externo"]="127.0.0.1";ordered["porta_http_externa"]=new Uri(device).Port;ordered["prioridade_conexao"]=new JsonArray("interno","externo","cloud");
  var response=await http.PostAsJsonAsync("/api/equipment",ordered);check(response.StatusCode==HttpStatusCode.Created,"failed first route falls back to authenticated second route and saves real channels");
  check(store.Cameras().Length==2,"real fixture channel count overrides browser input");
  check(store.Cameras().All(c=>new Uri(c.Source).Port==8554),"device RTSP port preserved");
  var persisted=new WebEquipment(root);check(persisted.Cameras().Length==2&&persisted.Cameras()[0].Password=="test-password","registration survives reload with DPAPI credentials");
  check(!File.ReadAllText(Path.Combine(root,"settings.json")).Contains("test-password"),"device password not plaintext on disk");
  var listing=await http.GetStringAsync("/api/equipment");check(!listing.Contains("test-password")&&!listing.Contains("ProtectedPassword"),"equipment API does not expose credential material");
  check(listing.Contains("ip_externo")&&listing.Contains("prioridade_conexao")&&persisted.Cameras()[0].ConnectionRoutes.Select(r=>r.Kind).SequenceEqual(new[]{"interno","externo"}),"connection routes and priority persist and are exposed without credentials");
  var oldCamera=new Camera{EquipmentId=Guid.NewGuid(),DeviceConnector="IntelbrasCloud",DeviceAddress="ibcloud://TESTSERIAL/",Source="rtsp://127.0.0.1:555/cam/realmonitor?channel=1&subtype=0",User="operator"};
  var legacy=System.Text.Json.JsonSerializer.Serialize(WebEquipmentMetadata.Rows([oldCamera]));
  check(legacy.Contains("\"fabricante\":\"Intelbras\"")&&legacy.Contains("TESTSERIAL")&&legacy.Contains("\"porta_rtsp_cloud\":555")&&legacy.Contains("\"porta_http_cloud\":null"),"existing cloud camera exposes manufacturer, real serial and RTSP port without inventing HTTP port");
  check((await http.PostAsJsonAsync("/api/equipment",Input())).StatusCode==HttpStatusCode.BadRequest&&store.Cameras().Length==2,"duplicate registration rejected without duplicated channels");
  check((await http.GetStringAsync("/api/cameras")).Contains("Entrada"),"registered cameras available to video catalog");
  var before=store.Cameras();var equipmentId=before[0].EquipmentId;
  var edit=Input();edit["senha"]=null;edit["nome"]="DVR editado";edit["modelo"]="Modelo teste";
  check((await http.PutAsJsonAsync("/api/equipment/"+equipmentId,edit)).StatusCode==HttpStatusCode.OK,"existing DVR can be updated through PUT with saved credentials");
  var after=store.Cameras();
  check(after.Select(c=>c.Id).SequenceEqual(before.Select(c=>c.Id))&&after.All(c=>c.Group=="DVR editado"&&c.ModelName=="Modelo teste"),"editing preserves camera identities and persists new metadata");
  check(after.All(c=>c.Password=="test-password"),"blank password preserves protected credentials");
  var disk=File.ReadAllText(Path.Combine(root,"settings.json"));
  edit["senha"]="bad";edit["nome"]="Must not save";
  check((await http.PutAsJsonAsync("/api/equipment/"+equipmentId,edit)).StatusCode==HttpStatusCode.BadRequest&&disk==File.ReadAllText(Path.Combine(root,"settings.json")),"failed edit leaves last working configuration unchanged");
  check((await http.PutAsJsonAsync("/api/equipment/"+Guid.NewGuid(),Input())).StatusCode==HttpStatusCode.NotFound,"unknown DVR edit rejected");
  await http.PostAsJsonAsync("/api/login",new{username=viewer.Name,password=TestCredentials.Password});
  check((await http.PutAsJsonAsync("/api/equipment/"+equipmentId,Input())).StatusCode==HttpStatusCode.Forbidden,"viewer cannot edit DVR");
  await http.PostAsJsonAsync("/api/login",new{username=admin.Name,password=TestCredentials.Password});
  var legacyId=Guid.NewGuid();legacyCameras=System.Text.Json.JsonSerializer.Deserialize<Camera[]>(System.Text.Json.JsonSerializer.Serialize(before))!;
  foreach(var c in legacyCameras){c.Id=Guid.NewGuid();c.EquipmentId=legacyId;}
  var importEdit=Input();importEdit["ip_interno"]="localhost";importEdit["senha"]=null;
  check((await http.PutAsJsonAsync("/api/equipment/"+legacyId,importEdit)).StatusCode==HttpStatusCode.OK,"legacy desktop DVR can be edited without re-entering stored password");
  var merged=legacyCameras.Concat(store.Cameras()).GroupBy(c=>c.Id).Select(g=>g.Last()).ToArray();
  check(merged.Length==4&&legacyCameras.All(old=>merged.Count(c=>c.Id==old.Id)==1),"legacy overrides do not duplicate cameras or break saved layout IDs");
  var newServer=await http.PostAsJsonAsync("/api/local-servers",new{nome="Fixture local",cliente_id="center-local",ativo=true});
  check(newServer.StatusCode==HttpStatusCode.Created,"admin creates local server with unique local license");
  var serverJson=JsonNode.Parse(await newServer.Content.ReadAsStringAsync())!;var sid=serverJson["id"]!.GetValue<string>();
  check(serverJson["licenca"]!.GetValue<string>().StartsWith("LOCAL-SV-"),"local license clearly separated from production licenses");
  await http.PostAsJsonAsync("/api/login",new{username=viewer.Name,password=TestCredentials.Password});
  check((await http.PostAsync("/api/local-servers/"+sid+"/bind",null)).StatusCode==HttpStatusCode.Forbidden,"viewer cannot assign license");
  await http.PostAsJsonAsync("/api/login",new{username=admin.Name,password=TestCredentials.Password});
  check((await http.PostAsync("/api/local-servers/"+sid+"/bind",null)).IsSuccessStatusCode,"admin binds local license to installation");
  check((await http.PostAsync("/api/local-servers/"+sid+"/bind",null)).IsSuccessStatusCode,"same installation binding is idempotent");
  var reopened=new LocalServerLicenses(Path.Combine(root,"licenses"));
  check(reopened.Servers().Single()!["vinculado_local"]!.GetValue<bool>()&&reopened.History().Single()!["status"]!.GetValue<string>()=="ativa","server assignment and license history survive restart");
  var second=await http.PostAsJsonAsync("/api/local-servers",new{nome="Second",cliente_id="center-local",ativo=true});var otherId=JsonNode.Parse(await second.Content.ReadAsStringAsync())!["id"]!.GetValue<string>();
  check((await http.PostAsync("/api/local-servers/"+otherId+"/bind",null)).StatusCode==HttpStatusCode.Conflict,"another binding cannot silently replace existing license assignment");
 }
}
