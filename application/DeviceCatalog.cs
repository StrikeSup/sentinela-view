using System.Text.Json;
namespace IndependentCenter;

public sealed record DeviceVendor(Guid Id, string Name, DeviceModel[] Models)
{ public override string ToString() => Name; }
public sealed record DeviceModel(Guid Id, Guid VendorId, string Name, string Connector, bool OnvifDiscovery, JsonElement Original)
{
    public override string ToString() => Name;
    public bool DahuaDiscovery => Connector == "TConectorDahuaHttp" && Original.TryGetProperty("ipProtocolClass",out var protocol) && protocol.GetString() == "TIpStreamDahuaHttp";
    public string Status => DahuaDiscovery ? "Conexão CGI Dahua e vídeo RTSP disponíveis; validar no equipamento." : OnvifDiscovery ? "Descoberta ONVIF disponível; validar recursos no equipamento." : "Driver específico ainda não implementado.";
}
public static class DeviceCatalog
{
    static readonly Lazy<DeviceVendor[]> cached = new(Read);
    public static IReadOnlyList<DeviceVendor> Vendors => cached.Value;
    public static DeviceModel? Find(Guid? vendor, Guid? model) => Vendors.FirstOrDefault(v => v.Id == vendor)?.Models.FirstOrDefault(m => m.Id == model);
    static DeviceVendor[] Read()
    {
        using var source = typeof(DeviceCatalog).Assembly.GetManifestResourceStream("Center.Catalog.models.json") ?? throw new InvalidDataException("Catálogo de equipamentos ausente.");
        using var doc = JsonDocument.Parse(source);
        return doc.RootElement.GetProperty("vendors").EnumerateArray().Select(v =>
        {
            var vendorId = Guid.Parse(v.GetProperty("guid").GetString()!);
            return new DeviceVendor(vendorId, v.GetProperty("name").GetString()!, v.GetProperty("models").EnumerateArray().Select(m =>
            {
                var connector = m.GetProperty("conectorClass").GetString()!;
                return new DeviceModel(Guid.Parse(m.GetProperty("guid").GetString()!), vendorId, m.GetProperty("name").GetString()!, connector,
                    connector is "TConectorOnvif" or "TConectorOnvifS", m.Clone());
            }).ToArray());
        }).ToArray();
    }
}
