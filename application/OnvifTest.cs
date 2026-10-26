namespace IndependentCenter;
static class OnvifTest
{
    public static async Task Run()
    {
        var result = new List<string>();
        try
        {
            using (var client = new OnvifClient("http://127.0.0.1:4917/onvif/device_service", "operator", "test-password"))
            {
                var p = await client.Profiles(); if (p.Count != 2 || p[0].Token != "profile-1" || p[0].StreamUri != "rtsp://127.0.0.1:8554/test") throw new Exception("Profile contract mismatch"); result.Add("PASS capabilities -> profiles -> stream URI over HTTP with verified UsernameToken digest");
                if (p[0].VideoSourceToken != "channel-1" || p[1].VideoSourceToken != "channel-1" || p[0].Token == p[1].Token) throw new Exception("Channel/profile identity mismatch");
                result.Add("PASS two independent profiles resolve to one physical source token over HTTP");
                if (p[0].PtzAddress != "http://127.0.0.1:4917/onvif/ptz_service") throw new Exception("PTZ capabilities mismatch");
                await client.MovePulse(p[0].PtzAddress, p[0].Token, .3f, 0, 0); result.Add("PASS PTZ pulse with finite timeout and explicit Stop over HTTP");
            }
            foreach (var test in new[] { ("unauthorized", typeof(UnauthorizedAccessException)), ("fault", typeof(InvalidDataException)), ("malformed", typeof(InvalidDataException)), ("slow", typeof(TaskCanceledException)) })
            { using var client = new OnvifClient("http://127.0.0.1:4917/onvif/" + test.Item1, "operator", "test-password", TimeSpan.FromMilliseconds(700)); try { await client.Profiles(); throw new Exception("Expected error: " + test.Item1); } catch (Exception e) when (test.Item2.IsInstanceOfType(e)) { result.Add("PASS " + test.Item1 + " handled as " + e.GetType().Name); } }
        }
        catch (Exception e) { result.Add(e.ToString()); Environment.ExitCode = 1; }
        File.WriteAllLines(Path.Combine(AppContext.BaseDirectory, "onvif-test.txt"), result);
    }
}
