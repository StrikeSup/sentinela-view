using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace IndependentCenter;
public sealed class Camera
{
    public List<CameraRoute> ConnectionRoutes { get; set; } = [];
    public string ManufacturerName {get;set;}="";
    public string ModelName {get;set;}="";
    public string DeviceConnector { get; set; } = "";
    public string DeviceAddress { get; set; } = "";
    public Guid? VendorId { get; set; }
    public Guid? ModelId { get; set; }
    public Guid? EquipmentId { get; set; }
    public string ChannelToken { get; set; } = "";
    public RecordingPlan Recording { get; set; } = new();
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "Nova câmera";
    public string Group { get; set; } = "Servidores";
    public string Source { get; set; } = "";
    public string Notes { get; set; } = "";
    public string User { get; set; } = "";
    public string ProtectedPassword { get; set; } = "";
    public bool AutoConnect { get; set; }
    public string OnvifAddress { get; set; } = "";
    public string PtzAddress { get; set; } = "";
    public string ProfileToken { get; set; } = "";
    [System.Text.Json.Serialization.JsonIgnore]
    public string Password { get => ProtectedPassword.Length == 0 ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(ProtectedPassword), null, DataProtectionScope.CurrentUser)); set => ProtectedPassword = value.Length == 0 ? "" : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser)); }
    public override string ToString() => Name;
}
public sealed class CameraRoute
{
    public string Kind {get;set;}="";
    public string Host {get;set;}="";
    public int HttpPort {get;set;}=80;
    public int RtspPort {get;set;}=554;
    public int? ServicePort {get;set;}
}
public sealed class SavedLayout
{
    public Guid Id {get;set;}=Guid.NewGuid();
    public string Name { get; set; } = "";
    public int Cells { get; set; } = 4;
    public List<Guid?> Cameras { get; set; } = [];
    public override string ToString() => Name;
}
public sealed class Settings
{
    public List<Equipment> Equipment { get; set; } = [];
    public List<PatrolPlan> Patrols {get;set;}=[];
    public int SchemaVersion { get; set; } = 1;
    public SavedLayout? LastLayout { get; set; }
    public List<EmergencyRecording> EmergencyRecordings { get; set; } = [];
    public List<Account> Accounts { get; set; } = [];
    public List<Camera> Cameras { get; set; } = [];
    public List<SavedLayout> Layouts { get; set; } = [];
    public int ReconnectSeconds { get; set; } = 60;
    public string RecordingDirectory { get; set; } = "";
}
public sealed class EmergencyRecording
{
    public Guid CameraId { get; set; }
    public DateTimeOffset? Expires { get; set; }
}
public sealed class Store
{
    public string Root { get; }
    public Settings Data { get; private set; }
    readonly JsonSerializerOptions options = new() { WriteIndented = true };
    public Store(string? root = null)
    {
        Root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IndependentCenter");
        Directory.CreateDirectory(Root);
        var path = Path.Combine(Root, "settings.json");
        Data = File.Exists(path) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(path)) ?? throw new InvalidDataException("Configuração inválida.") : new();
        if (Data.SchemaVersion != 1) throw new InvalidDataException("Versão de configuração incompatível com este executável.");
        Data.ReconnectSeconds = Math.Clamp(Data.ReconnectSeconds, 60, 300);
        if (string.IsNullOrWhiteSpace(Data.RecordingDirectory)) Data.RecordingDirectory = Path.Combine(Root, "recordings");
        Directory.CreateDirectory(Data.RecordingDirectory);
    }
    public void Save()
    {
        var path = Path.Combine(Root, "settings.json"); var temp = path + ".tmp";
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) { JsonSerializer.Serialize(stream, Data, options); stream.Flush(true); }
        File.Move(temp, path, true);
    }
    public void Log(string text) => File.AppendAllText(Path.Combine(Root, "events.log"), $"{DateTimeOffset.Now:O} {text}{Environment.NewLine}");
}
public sealed class ConnectionQueue
{
    readonly LinkedList<Guid> connect = [];
    readonly LinkedList<Guid> disconnect = [];
    public void Enqueue(Guid id, bool start)
    {
        var target = start ? connect : disconnect; var other = start ? disconnect : connect;
        other.Remove(id); if (!target.Contains(id)) target.AddLast(id);
    }
    public void Tick(Action<Guid> start, Func<Guid, bool> stop)
    {
        if (connect.First is { } c) { connect.RemoveFirst(); start(c.Value); }
        int active = 0;
        while (disconnect.First is { } d && active < 4) { disconnect.RemoveFirst(); if (stop(d.Value)) active++; }
    }
}
