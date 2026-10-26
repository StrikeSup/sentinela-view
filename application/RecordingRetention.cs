using System.Text.Json;
namespace IndependentCenter;

public static class RecordingRetention
{
    public sealed record CompletedFile(string Format, Guid CameraId, string FileName, DateTimeOffset CompletedUtc);
    const string Suffix = ".center-recording.json";
    public static void MarkCompleted(string path, Guid cameraId, DateTimeOffset now)
    {
        if (!File.Exists(path)) return;
        var record = new CompletedFile("IndependentCenter.Recording.v1", cameraId, Path.GetFileName(path), now);
        File.WriteAllText(path + Suffix, JsonSerializer.Serialize(record));
    }
    public static int Clean(Store store, Camera camera, DateTimeOffset now)
    {
        if (camera.Recording.RetentionHours <= 0) return 0;
        var root = Path.GetFullPath(store.Data.RecordingDirectory);
        var directory = Path.Combine(root, camera.Id.ToString());
        // Only our closed, indexed segments in this exact camera directory are eligible.
        // Refuse symlinks/junctions in the directory ancestry before any deletion.
        for (var parent = new DirectoryInfo(directory); parent is not null; parent = parent.Parent)
            if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) return 0;
        if (!Directory.Exists(directory)) return 0;
        int removed = 0;
        foreach (var index in Directory.EnumerateFiles(directory, "*" + Suffix, SearchOption.TopDirectoryOnly))
        {
            try
            {
                if ((File.GetAttributes(index) & FileAttributes.ReparsePoint) != 0) continue;
                var record = JsonSerializer.Deserialize<CompletedFile>(File.ReadAllText(index));
                if (record is null || record.Format != "IndependentCenter.Recording.v1" || record.CameraId != camera.Id ||
                    record.CompletedUtc > now.AddHours(-camera.Recording.RetentionHours) ||
                    record.FileName != Path.GetFileName(record.FileName) || !record.FileName.EndsWith(".ts", StringComparison.OrdinalIgnoreCase)) continue;
                var path = Path.GetFullPath(Path.Combine(directory, record.FileName));
                if (!string.Equals(Path.GetDirectoryName(path), directory, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(index, path + Suffix, StringComparison.OrdinalIgnoreCase)) continue;
                if (File.Exists(path))
                {
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
                    File.Delete(path); removed++;
                }
                File.Delete(index);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
            { store.Log("Retenção ignorou arquivo: " + e.GetType().Name); }
        }
        if (removed > 0) store.Log("Retenção removeu " + removed + " segmentos encerrados da câmera " + camera.Id);
        return removed;
    }
}
