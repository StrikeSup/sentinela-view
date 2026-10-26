namespace IndependentCenter;

// Original: cbModelNameChange reads the model default port only when the
// manual-port flag is clear; sePortChange sets that flag. Addresses are
// 0x16bf370 and 0x16c01d0 in the pinned original executable.
internal sealed class ServerPortChoice
{
    public int Port { get; private set; } = 554;
    public bool Customized { get; private set; }
    public void Load(int port, bool preserve) { Port = Math.Clamp(port, 1, 65535); Customized = preserve; }
    public void Edit(int port) { Load(port, true); }
    public int SelectModel(int defaultPort) { if (!Customized) Port = Math.Clamp(defaultPort, 1, 65535); return Port; }
}
