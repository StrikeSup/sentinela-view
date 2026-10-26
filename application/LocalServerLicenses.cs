using System.Text.Json.Nodes;
using System.Security.Cryptography;
namespace IndependentCenter;

// Local installation assignment only; does not issue production entitlements.
public sealed class LocalServerLicenses
{
 readonly string file;readonly object gate=new();
 public LocalServerLicenses(string root){Directory.CreateDirectory(root);file=Path.Combine(root,"local-servers.json");}
 JsonObject Load()=>File.Exists(file)?JsonNode.Parse(File.ReadAllText(file))!.AsObject():new JsonObject{["instanceId"]=Guid.NewGuid().ToString(),["boundServer"]=null,["servers"]=new JsonArray(),["licenses"]=new JsonArray()};
 void Save(JsonObject data){var tmp=file+".tmp";using(var stream=new FileStream(tmp,FileMode.Create,FileAccess.Write,FileShare.None)){System.Text.Json.JsonSerializer.Serialize(stream,data);stream.Flush(true);}File.Move(tmp,file,true);}
 public JsonArray Servers(){lock(gate){var data=Load();var rows=(JsonArray)data["servers"]!.DeepClone();foreach(var row in rows){bool bound=row!["id"]!.GetValue<string>()==data["boundServer"]?.GetValue<string>();row["online"]=bound;row["vinculado_local"]=bound;if(bound)row["ultimo_contato"]=DateTimeOffset.UtcNow.ToString("O");}return rows;}}
 public JsonArray History(){lock(gate)return (JsonArray)Load()["licenses"]!.DeepClone();}
 public JsonObject Create(JsonObject input){lock(gate){
  var name=input["nome"]?.GetValue<string>()?.Trim()??"";if(name.Length is <1 or >150)throw new ArgumentException("Informe o nome do servidor.");
  if(input["cliente_id"]?.GetValue<string>()!="center-local")throw new ArgumentException("Selecione o cliente local.");
  if(input["ativo"]?.GetValue<bool>()==false)throw new ArgumentException("Cadastre o servidor local como ativo.");
  var data=Load();var id=Guid.NewGuid().ToString();var code="LOCAL-SV-"+Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
  var row=new JsonObject{["id"]=id,["nome"]=name,["cliente_id"]="center-local",["licenca"]=code,["ativo"]=true,["online"]=false,["descricao"]=input["descricao"]?.DeepClone(),["ip"]="127.0.0.1",["base_url"]="http://127.0.0.1:8095",["offline_apos_minutos"]=1,["clientes"]=new JsonObject{["nome"]="Center local"}};
  data["servers"]!.AsArray().Add(row);data["licenses"]!.AsArray().Add(new JsonObject{["id"]=Guid.NewGuid().ToString(),["servidor_id"]=id,["codigo"]=code,["status"]="disponivel"});Save(data);return (JsonObject)row.DeepClone();
 }}
 public JsonObject Bind(string id){lock(gate){var data=Load();var row=data["servers"]!.AsArray().FirstOrDefault(r=>r!["id"]!.GetValue<string>()==id)??throw new ArgumentException("Servidor não encontrado.");
  var bound=data["boundServer"]?.GetValue<string>();if(bound is not null&&bound!=id)throw new InvalidOperationException("Esta instalação já está vinculada a outro servidor. Transferência não está disponível nesta versão.");
  var license=data["licenses"]!.AsArray().Single(r=>r!["servidor_id"]!.GetValue<string>()==id)!;
  if(license["status"]!.GetValue<string>() is not ("disponivel" or "ativa"))throw new InvalidOperationException("Licença indisponível.");
  data["boundServer"]=id;license["status"]="ativa";license["instance_id"]=data["instanceId"]!.DeepClone();license["vinculada_em"]??=DateTimeOffset.UtcNow.ToString("O");Save(data);
  return new JsonObject{["id"]=id,["nome"]=row["nome"]!.DeepClone(),["licenca"]=row["licenca"]!.DeepClone(),["vinculado_local"]=true};
 }}
}
