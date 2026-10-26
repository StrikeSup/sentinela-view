namespace IndependentCenter;
static class WebEquipmentMetadata
{
 public static object[] Rows(Camera[] cameras)=>cameras.GroupBy(c=>c.EquipmentId??c.Id).Select(g=>{
  var c=g.First();Uri.TryCreate(c.DeviceAddress.Length>0?c.DeviceAddress:c.OnvifAddress,UriKind.Absolute,out var endpoint);
  Uri.TryCreate(c.Source,UriKind.Absolute,out var stream);
  var cloud=endpoint?.Scheme=="ibcloud";
  var routes=c.ConnectionRoutes;
  var inside=routes.FirstOrDefault(r=>r.Kind=="interno");var outside=routes.FirstOrDefault(r=>r.Kind=="externo");var remote=routes.FirstOrDefault(r=>r.Kind=="cloud");
  var model=DeviceCatalog.Find(c.VendorId,c.ModelId);
  var vendor=DeviceCatalog.Vendors.FirstOrDefault(v=>v.Id==c.VendorId)?.Name;
  return (object)new {
   id=g.Key,nome=c.Group,cliente_id="center-local",servidor_id="center",canais=g.Count(),ativo=true,online=(bool?)null,
   fabricante=c.ManufacturerName.Length>0?c.ManufacturerName:vendor??(cloud?"Intelbras":c.DeviceConnector=="DahuaHTTP"?"Dahua":"ONVIF"),modelo=c.ModelName.Length>0?c.ModelName:model?.Name??"",usuario=c.User,senha="",
   cloud=remote?.Host??(cloud?endpoint!.Host.ToUpperInvariant():""),
   ip_interno=inside?.Host??(!cloud?endpoint?.Host??"":""),ip_externo=outside?.Host??"",
   porta_http_interna=inside?.HttpPort??(!cloud?endpoint?.Port:null),porta_rtsp_interna=inside?.RtspPort??(!cloud?stream?.Port:null),porta_servico_interna=inside?.ServicePort,
   porta_http_externa=outside?.HttpPort,porta_rtsp_externa=outside?.RtspPort,porta_servico_externa=outside?.ServicePort,
   porta_http_cloud=remote?.HttpPort,porta_cloud=remote?.ServicePort,porta_rtsp_cloud=remote?.RtspPort??(cloud?stream?.Port:null),
   prioridade_conexao=routes.Count>0?routes.Select(r=>r.Kind).Concat(new[]{"interno","externo","cloud"}).Distinct().ToArray():cloud?new[]{"cloud","interno","externo"}:new[]{"interno","externo","cloud"},
   observacao="Senha preservada no Center. Campos sem valor não constam no cadastro de origem.",
   clientes=new{nome="Center local"},servidores=new{nome="Center neste computador"}
  };
 }).ToArray();
}
