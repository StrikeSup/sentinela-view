using System.Net;
using System.Net.Http;
using System.Globalization;
namespace IndependentCenter;

// Contract provenance: manufacturers-native/evidence/dahua-driver and dahua-channel-names.
public sealed class DahuaHttpClient : IDisposable
{
    readonly HttpClient http;
    readonly Uri endpoint;
    public string DeviceType { get; private set; } = "";
    public string Firmware { get; private set; } = "";
    public DahuaHttpClient(string address, string user, string password, TimeSpan? timeout = null)
    {
        endpoint = new Uri(address);
        if (endpoint.Scheme is not ("http" or "https") || endpoint.UserInfo.Length > 0 || endpoint.AbsolutePath != "/" || endpoint.Query.Length > 0 || endpoint.Fragment.Length > 0)
            throw new ArgumentException("Informe apenas http://IP:PORTA ou https://IP:PORTA, sem credenciais na URL.");
        http = new(new HttpClientHandler { Credentials = new NetworkCredential(user, password), AllowAutoRedirect = false })
        { BaseAddress=endpoint, Timeout=timeout ?? TimeSpan.FromSeconds(8), MaxResponseContentBufferSize=2*1024*1024,
          DefaultRequestVersion=HttpVersion.Version11, DefaultVersionPolicy=HttpVersionPolicy.RequestVersionExact };
        // Original queue preparation 0x24a2fc0: HTTP/1.1, Connection: Close.
        http.DefaultRequestHeaders.ConnectionClose=true;
    }
    async Task<Dictionary<string,string>> Get(string path, CancellationToken cancel)
    {
        using var response = await http.GetAsync(path, cancel);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new UnauthorizedAccessException("Credenciais ou permissões CGI recusadas pelo equipamento.");
        if ((int)response.StatusCode is >=300 and <400) throw new InvalidDataException("O equipamento tentou redirecionar a conexão.");
        response.EnsureSuccessStatusCode();
        // 0x24a3180 / 0x24a3260 only deliver nonempty HTTP 200 bodies.
        if(response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException("Resposta CGI inesperada: HTTP "+(int)response.StatusCode);
        var text=await response.Content.ReadAsStringAsync(cancel);
        if(text.Length==0) throw new InvalidDataException("O equipamento retornou uma resposta CGI vazia.");
        var values=new Dictionary<string,string>(StringComparer.Ordinal);
        foreach(var line in text.Split('\n')) { var i=line.IndexOf('='); if(i>0 && !values.TryAdd(line[..i].Trim(),line[(i+1)..].TrimEnd('\r'))) throw new InvalidDataException("Resposta CGI contém chaves duplicadas."); }
        return values;
    }
    static string Required(Dictionary<string,string> values,string key) => values.TryGetValue(key,out var value) && !string.IsNullOrWhiteSpace(value) ? value : throw new InvalidDataException("Resposta CGI incompleta: "+key);
    static int Count(Dictionary<string,string> values,string key) => int.TryParse(Required(values,key),NumberStyles.None,CultureInfo.InvariantCulture,out var n) && n is >=0 and <=1024 ? n : throw new InvalidDataException("Quantidade de canais inválida.");
    public async Task<int?> ReadRtspPort(CancellationToken cancel=default)
    {
        foreach(var section in new[]{"RTSP","Network"})
        {
            try {
                var config=await Get("/cgi-bin/configManager.cgi?action=getConfig&name="+section,cancel);
                foreach(var key in new[]{"table.RTSP.Port","table.Network.RTSP.Port"})
                    if(config.TryGetValue(key,out var value) && int.TryParse(value,out var port) && port is >0 and <=65535)return port;
            } catch(HttpRequestException){} catch(InvalidDataException){}
        }
        return null;
    }
    public async Task<IReadOnlyList<OnvifProfile>> Profiles(int rtspPort, int streams, CancellationToken cancel=default, int? channelCapacity=null)
    {
        if(rtspPort is <1 or >65535 || streams is <1 or >3) throw new ArgumentOutOfRangeException(nameof(rtspPort));
        if(channelCapacity is <1 or >1024) throw new ArgumentOutOfRangeException(nameof(channelCapacity));
        DeviceType=Required(await Get("/cgi-bin/magicBox.cgi?action=getDeviceType",cancel),"type");
        var analog=Count(await Get("/cgi-bin/devVideoInput.cgi?action=getCollect",cancel),"result");
        var digital=Count(await Get("/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxRemoteInputChannels",cancel),"table.MaxRemoteInputChannels");
        var total=analog+digital;
        if(total is <1 or >1024) throw new InvalidDataException("O equipamento não informou uma quantidade válida de canais.");
        // 0x261ee00 enables only existing model channels whose index is below the reported sum.
        if(channelCapacity.HasValue) total=Math.Min(total,channelCapacity.Value);
        var names=await Get("/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle",cancel);
        Firmware=Required(await Get("/cgi-bin/magicBox.cgi?action=getSoftwareVersion",cancel),"version");
        var result=new List<OnvifProfile>();
        for(int channel=0;channel<total;channel++)
        {
            var name=names.GetValueOrDefault($"table.ChannelTitle[{channel}].Name", "Canal "+(channel+1));
            if(string.IsNullOrWhiteSpace(name)) name="Canal "+(channel+1);
            for(int subtype=0;subtype<streams;subtype++)
            {
                var uri=new UriBuilder("rtsp",endpoint.Host,rtspPort,"/cam/realmonitor") { Query=$"channel={channel+1}&subtype={subtype}" }.Uri.AbsoluteUri;
                result.Add(new($"channel:{channel+1}:stream:{subtype}",name+" — "+(subtype==0 ? "Principal" : "Secundário "+subtype),uri,"",(channel+1).ToString(CultureInfo.InvariantCulture)));
            }
        }
        return result;
    }
    public void Dispose()=>http.Dispose();
}
