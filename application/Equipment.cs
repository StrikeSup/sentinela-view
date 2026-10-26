namespace IndependentCenter;

public sealed class Equipment
{
    public string ManufacturerName { get; set; } = "";
    public string ModelName { get; set; } = "";
    public Guid? VendorId { get; set; }
    public Guid? ModelId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Connector { get; set; } = "ONVIF";
    public string Endpoint { get; set; } = "";
    public DateTimeOffset LastDiscovery { get; set; }
}

public static class EquipmentCatalog
{
    public static string EndpointKey(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "ibcloud") || uri.UserInfo.Length > 0 || uri.Fragment.Length > 0)
            throw new ArgumentException("Endereço ONVIF inválido.");
        if(uri.Scheme=="ibcloud" && (uri.Host.Length==0 || uri.AbsolutePath!="/" || uri.Query.Length>0 || !uri.IsDefaultPort)) throw new ArgumentException("Endereço Intelbras Cloud inválido.");
        return uri.GetComponents(UriComponents.SchemeAndServer | UriComponents.PathAndQuery, UriFormat.UriEscaped);
    }

    // Selected profiles are upserted. Unselected/missing profiles are never silently removed.
    public static IReadOnlyList<Camera> ImportProfiles(Store store, IReadOnlyList<Camera> selected, string? manufacturer = null, string? modelName = null)
    {
        if (selected.Count == 0) return [];
        var driver = selected[0].DeviceConnector.Length > 0 ? selected[0].DeviceConnector : "ONVIF";
        string Address(Camera c) => c.DeviceConnector.Length > 0 ? c.DeviceAddress : c.OnvifAddress;
        var endpoint = EndpointKey(Address(selected[0]));
        if (selected.Any(c => c.VendorId != selected[0].VendorId || c.ModelId != selected[0].ModelId)) throw new ArgumentException("Os perfis devem pertencer ao mesmo modelo.");
        if (selected.Any(c => (c.DeviceConnector.Length > 0 ? c.DeviceConnector : "ONVIF") != driver || EndpointKey(Address(c)) != endpoint || string.IsNullOrWhiteSpace(c.ProfileToken)) || selected.Select(c => c.ProfileToken).Distinct(StringComparer.Ordinal).Count() != selected.Count)
            throw new ArgumentException("Selecione perfis distintos do mesmo equipamento.");
        var oldCameras = store.Data.Cameras; var oldEquipment = store.Data.Equipment;
        var existing = oldEquipment.SingleOrDefault(e => e.Connector == driver && e.Endpoint == endpoint);
        var equipment = new Equipment { Id = existing?.Id ?? Guid.NewGuid(), Name = existing?.Name ?? selected[0].Group, Endpoint = endpoint, LastDiscovery = DateTimeOffset.UtcNow };
        equipment.Connector = driver;
        equipment.ManufacturerName=manufacturer??existing?.ManufacturerName??"";
        equipment.ModelName=modelName??existing?.ModelName??"";
        equipment.VendorId = selected[0].VendorId ?? existing?.VendorId;
        equipment.ModelId = selected[0].ModelId ?? existing?.ModelId;
        if (string.IsNullOrWhiteSpace(equipment.Name)) equipment.Name = new Uri(endpoint).Host;
        var cameras = oldCameras.ToList(); var changed = new List<Camera>();
        foreach (var discovered in selected)
        {
            var matches = cameras.Where(c => c.ProfileToken == discovered.ProfileToken &&
                (c.EquipmentId == equipment.Id || (c.EquipmentId is null && (c.DeviceConnector.Length > 0 ? c.DeviceConnector : "ONVIF") == driver && SameEndpoint(Address(c), endpoint)))).ToArray();
            if (matches.Length > 1) throw new InvalidDataException("Existem perfis duplicados no cadastro antigo. Remova a duplicata antes de redescobrir.");
            var previous = matches.SingleOrDefault();
            var updated = new Camera
            {
                Id = previous?.Id ?? discovered.Id, EquipmentId = equipment.Id, Name = previous?.Name ?? discovered.Name,
                VendorId = equipment.VendorId, ModelId = equipment.ModelId,
                Group = equipment.Name, Source = discovered.Source, User = discovered.User, ProtectedPassword = discovered.ProtectedPassword,
                OnvifAddress = driver == "ONVIF" ? endpoint : "", ProfileToken = discovered.ProfileToken, PtzAddress = discovered.PtzAddress,
                DeviceConnector = driver == "ONVIF" ? "" : driver, DeviceAddress = driver == "ONVIF" ? "" : endpoint,
                ChannelToken = discovered.ChannelToken,
                ConnectionRoutes = discovered.ConnectionRoutes,
                ManufacturerName=discovered.ManufacturerName,ModelName=discovered.ModelName,
                AutoConnect = previous?.AutoConnect ?? discovered.AutoConnect, Notes = previous?.Notes ?? discovered.Notes,
                Recording = previous?.Recording ?? discovered.Recording
            };
            if (previous is not null) cameras[cameras.IndexOf(previous)] = updated; else cameras.Add(updated);
            changed.Add(updated);
        }
        store.Data.Cameras = cameras;
        store.Data.Equipment = oldEquipment.Where(e => e.Id != equipment.Id).Append(equipment).ToList();
        try { store.Save(); }
        catch { store.Data.Cameras = oldCameras; store.Data.Equipment = oldEquipment; throw; }
        return changed;
    }
    static bool SameEndpoint(string candidate, string endpoint)
    { try { return EndpointKey(candidate) == endpoint; } catch (ArgumentException) { return false; } }
}


