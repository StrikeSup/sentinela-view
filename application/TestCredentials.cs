namespace IndependentCenter;
// Test fixtures create their own random passwords; no deployment credentials.
static class TestCredentials
{
    public static readonly string Password=Guid.NewGuid().ToString("N");
    public static readonly string OtherPassword=Guid.NewGuid().ToString("N");
}
