namespace IndependentCenter;
static class EquipmentTests
{
    public static void Run(Action<bool, string> check, string root)
    {
        var store = new Store(Path.Combine(root, "equipment"));
        var cloudStore=new Store(Path.Combine(root,"cloud-equipment"));
        var cloud=new Camera{Name="Cloud fixture",Source="rtsp://127.0.0.1:554/cam/realmonitor?channel=1&subtype=0",DeviceConnector="IntelbrasCloud",DeviceAddress="ibcloud://FIXTURE123/",ProfileToken="channel:1:stream:0",ChannelToken="1"};
        var cloudId=EquipmentCatalog.ImportProfiles(cloudStore,[cloud])[0].Id;
        EquipmentCatalog.ImportProfiles(cloudStore,[cloud]);var cloudReloaded=new Store(cloudStore.Root);
        check(cloudReloaded.Data.Equipment.Single().Connector=="IntelbrasCloud" && cloudReloaded.Data.Cameras.Single().Id==cloudId && cloudReloaded.Data.Cameras.Single().DeviceAddress=="ibcloud://fixture123/","Cloud preserva identidade do serial ao redescobrir e reiniciar, sem gravar porta efêmera");
        try{EquipmentCatalog.EndpointKey("ibcloud://fixture123/?password=secret");throw new Exception("Cloud endpoint accepted query");}catch(ArgumentException){check(true,"Cloud rejeita query no identificador persistido");}
        Camera Profile(string token, string source) => new() { Name = "Perfil " + token, Group = "Gravador", OnvifAddress = "http://example.invalid:80/onvif/device_service", ProfileToken = token, ChannelToken = "source-1", Source = source };
        var first = EquipmentCatalog.ImportProfiles(store, [Profile("main", "rtsp://example.invalid/old"), Profile("sub", "rtsp://example.invalid/sub")]);
        check(DeviceCatalog.Vendors.Count == 385 && DeviceCatalog.Vendors.Sum(v => v.Models.Length) == 8813, "Catálogo integral embarcado com 385 entradas e 8813 modelos");
        var selectedModel = DeviceCatalog.Vendors.First(v => v.Name == "Intelbras").Models.First(m => m.OnvifDiscovery);
        var identified = Profile("main", "rtsp://example.invalid/old"); identified.VendorId = selectedModel.VendorId; identified.ModelId = selectedModel.Id;
        EquipmentCatalog.ImportProfiles(store, [identified]);
        first = store.Data.Cameras.ToArray();
        check(store.Data.Equipment.Count == 1 && first.All(c => c.EquipmentId == store.Data.Equipment[0].Id), "Equipamento persistido separadamente de seus perfis");
        check(first.Select(c => c.ChannelToken).Distinct().Count() == 1 && first.Select(c => c.ProfileToken).Distinct().Count() == 2, "Streams principal e secundário pertencem ao mesmo canal");
        var id = first[0].Id; first[0].Name = "Nome personalizado"; first[0].Recording.Enabled = true;
        store.Data.Layouts.Add(new() { Name = "Meu layout", Cameras = [id] }); store.Save();
        var updated = EquipmentCatalog.ImportProfiles(store, [Profile("main", "rtsp://example.invalid/new")]);
        check(store.Data.Cameras.Count == 2 && updated[0].Id == id && updated[0].Source.EndsWith("/new"), "Redescoberta atualiza stream sem duplicar perfil nem alterar identidade");
        check(updated[0].Name == "Nome personalizado" && updated[0].Recording.Enabled && store.Data.Layouts[0].Cameras[0] == id, "Redescoberta preserva nome, gravação e layout");
        var restored = new Store(store.Root); check(restored.Data.Equipment.Count == 1 && restored.Data.Cameras.All(c => c.EquipmentId == restored.Data.Equipment[0].Id), "Equipamento e vínculos sobrevivem ao reinício");
        check(restored.Data.Equipment[0].ModelId == selectedModel.Id && restored.Data.Cameras.First(c=>c.Id == id).ModelId == selectedModel.Id, "Fabricante e modelo preservados após redescoberta e reinício");
        try { EquipmentCatalog.ImportProfiles(store, [Profile("main", "a"), Profile("main", "b")]); throw new Exception("Duplicata aceita"); }
        catch (ArgumentException) { check(store.Data.Cameras.Count == 2, "Seleção duplicada rejeitada antes de alterar o cadastro"); }
        var legacy = new Store(Path.Combine(root, "legacy-equipment")); var old = Profile("main", "rtsp://example.invalid/old"); legacy.Data.Cameras.Add(old); legacy.Save();
        var migrated = EquipmentCatalog.ImportProfiles(legacy, [Profile("main", "rtsp://example.invalid/new")]);
        check(legacy.Data.Cameras.Count == 1 && migrated[0].Id == old.Id, "Perfil legado adotado sem duplicar nem trocar ID");
        var before = store.Data.Cameras; var beforeEquipment = store.Data.Equipment;
        Directory.CreateDirectory(Path.Combine(store.Root, "settings.json.tmp"));
        try { EquipmentCatalog.ImportProfiles(store, [Profile("new", "rtsp://example.invalid/new")]); throw new Exception("Falha de persistência não propagada"); }
        catch (UnauthorizedAccessException) { check(ReferenceEquals(before, store.Data.Cameras) && ReferenceEquals(beforeEquipment, store.Data.Equipment), "Falha de persistência restaura cadastro em memória"); }
    }
}

