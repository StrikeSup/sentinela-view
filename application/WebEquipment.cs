using System.Text.Json.Nodes;
namespace IndependentCenter;

// Separate persistent local catalog: the desktop's older in-memory Store cannot overwrite it.
public sealed class WebEquipment
{
    readonly string root;
    readonly SemaphoreSlim gate = new(1,1);
    public WebEquipment(string root) { this.root=root; }
    public Camera[] Cameras() => new Store(root).Data.Cameras.ToArray();
    public object[] Rows() => new Store(root).Data.Equipment.Select(e => (object)new {
        id=e.Id,nome=e.Name,cliente_id="center-local",servidor_id="center",fabricante=e.ManufacturerName.Length>0?e.ManufacturerName:e.Connector=="IntelbrasCloud"?"Intelbras":e.Connector=="DahuaHTTP"?"Dahua":"ONVIF",
        canais=Cameras().Count(c=>c.EquipmentId==e.Id),ativo=true,online=(bool?)null,modelo=e.ModelName,senha="",
        cloud=e.Connector=="IntelbrasCloud"?new Uri(e.Endpoint).Host:"",ip_interno=e.Connector=="IntelbrasCloud"?"":new Uri(e.Endpoint).Host,
        status_texto="Cadastro consultado; vídeo ainda não validado",clientes=new{nome="Center local"},servidores=new{nome="Center neste computador"}
    }).ToArray();
    public async Task<object> Create(JsonObject input, CancellationToken cancel)
        => await Save(input,[],cancel);
    public async Task<object> Update(JsonObject input,Camera[] previous,CancellationToken cancel)
    {
        if(previous.Length==0)throw new ArgumentException("DVR não encontrado.");
        if(string.IsNullOrEmpty(input["senha"]?.GetValue<string>()))input["senha"]=previous[0].Password;
        return await Save(input,previous,cancel);
    }
    async Task<object> Save(JsonObject input,Camera[] previous,CancellationToken cancel)
    {
        var order=input["prioridade_conexao"] is JsonArray array?array.Select(x=>x?.GetValue<string>()??"").ToArray():new[]{"interno","externo","cloud"};
        if(order.Length!=3||order.Distinct().Count()!=3||order.Any(k=>k is not ("interno" or "externo" or "cloud")))throw new ArgumentException("Prioridade deve conter interno, externo e cloud, uma vez cada.");
        var routes=new List<CameraRoute>();
        foreach(var kind in order){
            var key=kind=="cloud"?"cloud":"ip_"+kind;var host=input[key]?.GetValue<string>()?.Trim()??"";if(host.Length==0)continue;
            int P(string key,int fallback){var value=input[key]?.GetValue<int>()??fallback;if(value is <1 or >65535)throw new ArgumentException("Porta inválida: "+key);return value;}
            var suffix=kind=="interno"?"interna":"externa";
            if(kind=="cloud"&&(input["fabricante"]?.GetValue<string>()!="Intelbras"||!System.Text.RegularExpressions.Regex.IsMatch(host,"^[A-Za-z0-9]{6,64}$")))throw new ArgumentException("Cloud requer fabricante Intelbras e serial válido.");
            if(kind!="cloud"&&Uri.CheckHostName(host)==UriHostNameType.Unknown)throw new ArgumentException("IP ou domínio inválido.");
            routes.Add(new(){Kind=kind,Host=host,HttpPort=P(kind=="cloud"?"porta_http_cloud":"porta_http_"+suffix,80),RtspPort=P(kind=="cloud"?"porta_rtsp_cloud":"porta_rtsp_"+suffix,554),ServicePort=input[kind=="cloud"?"porta_cloud":"porta_servico_"+suffix]?.GetValue<int>()});
        }
        if(routes.Count==0)throw new ArgumentException("Informe ao menos uma conexão.");
        if(routes.Count>1&&input["fabricante"]?.GetValue<string>()=="ONVIF")throw new ArgumentException("Prioridade com várias rotas disponível para Intelbras/Dahua. ONVIF aceita uma rota nesta versão.");
        foreach(var route in routes){
            var candidate=(JsonObject)input.DeepClone();candidate["ip_interno"]=null;candidate["ip_externo"]=null;candidate["cloud"]=null;
            candidate[route.Kind=="cloud"?"cloud":"ip_"+route.Kind]=route.Host;
            try{return await CreateOne(candidate,routes,previous,cancel);}
            catch(Exception e)when(routes.Count>1&&(e is IOException or HttpRequestException or UnauthorizedAccessException or Grpc.Core.RpcException or OperationCanceledException)&&!cancel.IsCancellationRequested){}
        }
        throw new IOException("Nenhuma conexão configurada respondeu.");
    }
    async Task<object> CreateOne(JsonObject input,List<CameraRoute> routes,Camera[] previous,CancellationToken cancel)
    {
        string S(string k)=>input[k]?.GetValue<string>()?.Trim()??"";
        int Port(string k,int fallback) { var n=input[k]?.GetValue<int>()??fallback;if(n is <1 or >65535)throw new ArgumentException("Porta inválida: "+k);return n; }
        var name=S("nome");var vendor=S("fabricante");var user=S("usuario");var password=input["senha"]?.GetValue<string>()??"";
        if(name.Length is <1 or >150 || user.Length is <1 or >100 || password.Length>1024)throw new ArgumentException("Informe nome e usuário válidos.");
        if(vendor is not ("Intelbras" or "Dahua" or "ONVIF"))throw new ArgumentException("Conector ainda não disponível no cadastro local.");
        var addresses=new[]{S("ip_interno"),S("ip_externo"),S("cloud")};
        if(addresses.Count(a=>a.Length>0)!=1)throw new ArgumentException("Informe uma conexão: IP interno, IP externo ou Cloud. Failover automático ainda não está integrado.");
        bool cloud=addresses[2].Length>0;bool external=addresses[1].Length>0;
        if(cloud&&vendor!="Intelbras")throw new ArgumentException("Cloud disponível apenas para Intelbras nesta integração.");
        var connector=cloud?"IntelbrasCloud":vendor=="ONVIF"?"ONVIF":"DahuaHTTP";
        var host=cloud?addresses[2]:external?addresses[1]:addresses[0];
        if(cloud&&!System.Text.RegularExpressions.Regex.IsMatch(host,"^[A-Za-z0-9]{6,64}$"))throw new ArgumentException("Número de série Cloud inválido.");
        if(!cloud&&(Uri.CheckHostName(host)==UriHostNameType.Unknown||host.Contains('/')||host.Contains('@')))throw new ArgumentException("Informe apenas IP ou domínio, sem URL ou credenciais.");
        int httpPort=Port(cloud?"porta_http_cloud":external?"porta_http_externa":"porta_http_interna",80);
        int rtspPort=Port(external?"porta_rtsp_externa":"porta_rtsp_interna",554);
        var endpoint=cloud?"ibcloud://"+host.ToLowerInvariant()+"/":new UriBuilder("http",host,httpPort).Uri.AbsoluteUri;
        if(connector=="ONVIF")endpoint=new Uri(new Uri(endpoint),"onvif/device_service").AbsoluteUri;
        if(!await gate.WaitAsync(0,cancel))throw new InvalidOperationException("Outro cadastro está em andamento. Aguarde.");
        try {
            var store=new Store(root);
            var oldId=previous.FirstOrDefault()?.EquipmentId??previous.FirstOrDefault()?.Id;
            if(store.Data.Equipment.Any(e=>e.Endpoint==endpoint&&e.Connector==connector&&e.Id!=oldId))throw new InvalidOperationException("Este equipamento já está cadastrado pelo Guardian.");
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancel);deadline.CancelAfter(TimeSpan.FromSeconds(90));
            IReadOnlyList<OnvifProfile> profiles;
            IntelbrasCloudSession? tunnel=null;
            try {
                var address=endpoint;
                if(cloud){tunnel=new IntelbrasCloudSession(host);address="http://127.0.0.1:"+await tunnel.OpenPort(httpPort,deadline.Token)+"/";}
                if(connector=="ONVIF") { using var client=new OnvifClient(address,user,password,TimeSpan.FromSeconds(15));profiles=await client.Profiles(deadline.Token); }
                else { using var client=new DahuaHttpClient(address,user,password,TimeSpan.FromSeconds(15));rtspPort=await client.ReadRtspPort(deadline.Token)??rtspPort;profiles=await client.Profiles(rtspPort,1,deadline.Token); }
            } finally { if(tunnel is not null)await tunnel.DisposeAsync(); }
            var selected=profiles.GroupBy(p=>p.VideoSourceToken.Length>0?p.VideoSourceToken:p.Token).Select(g=>g.First()).Take(64).ToArray();
            if(selected.Length==0)throw new InvalidDataException("O equipamento não retornou canais.");
            var cameras=selected.Select(p=>new Camera {Name=p.Name,Group=name,User=user,Password=password,Source=p.StreamUri,DeviceConnector=connector=="ONVIF"?"":connector,DeviceAddress=connector=="ONVIF"?"":endpoint,OnvifAddress=connector=="ONVIF"?endpoint:"",ProfileToken=p.Token,ChannelToken=p.VideoSourceToken,PtzAddress=p.PtzAddress}).ToArray();
            var selectedRoute=routes.Single(r=>r.Kind==(cloud?"cloud":external?"externo":"interno"));selectedRoute.RtspPort=rtspPort;
            foreach(var camera in cameras){camera.ConnectionRoutes=routes;camera.ManufacturerName=vendor;camera.ModelName=S("modelo");}
            if(oldId.HasValue){
                var updated=previous.ToList();
                foreach(var camera in cameras){
                    var old=previous.FirstOrDefault(c=>c.ChannelToken==camera.ChannelToken&&c.ProfileToken==camera.ProfileToken)
                        ??previous.FirstOrDefault(c=>c.ChannelToken.Length>0&&c.ChannelToken==camera.ChannelToken);
                    camera.EquipmentId=oldId.Value;
                    if(old is not null){camera.Id=old.Id;camera.Name=old.Name;camera.Recording=old.Recording;camera.AutoConnect=old.AutoConnect;camera.Notes=old.Notes;updated[updated.IndexOf(old)]=camera;}
                    else updated.Add(camera);
                }
                // Retain undiscovered channels rather than silently removing layouts or recordings.
                store.Data.Cameras=store.Data.Cameras.Where(c=>(c.EquipmentId??c.Id)!=oldId.Value).Concat(updated).ToList();
                store.Data.Equipment=store.Data.Equipment.Where(e=>e.Id!=oldId.Value).Append(new Equipment{Id=oldId.Value,Name=name,Connector=connector,Endpoint=endpoint,ManufacturerName=vendor,ModelName=S("modelo"),LastDiscovery=DateTimeOffset.UtcNow}).ToList();
                store.Save();
                return new{id=oldId.Value,nome=name,canais=updated.Count,cliente_id="center-local",servidor_id="center",ativo=true};
            }
            var imported=EquipmentCatalog.ImportProfiles(store,cameras,vendor,S("modelo"));var id=imported[0].EquipmentId;
            return new {id,nome=name,canais=imported.Count,cliente_id="center-local",servidor_id="center",ativo=true};
        } finally {gate.Release();}
    }
}
