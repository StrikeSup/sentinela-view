using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace IndependentCenter;
public sealed record OnvifProfile(string Token, string Name, string StreamUri, string PtzAddress = "", string VideoSourceToken = "");
public sealed class OnvifClient : IDisposable
{
    static readonly XNamespace Ptz = "http://www.onvif.org/ver20/ptz/wsdl";
    static readonly XNamespace Soap = "http://www.w3.org/2003/05/soap-envelope", Device = "http://www.onvif.org/ver10/device/wsdl", Media = "http://www.onvif.org/ver10/media/wsdl", Schema = "http://www.onvif.org/ver10/schema";
    static readonly XNamespace Security = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd", Utility = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
    readonly HttpClient http; readonly Uri endpoint; readonly string user, password;
    public OnvifClient(string address, string user, string password, TimeSpan? timeout = null)
    {
        endpoint = new Uri(address); ValidateHttp(endpoint); this.user = user; this.password = password;
        http = new(new HttpClientHandler { Credentials = new NetworkCredential(user, password), AllowAutoRedirect = false }) { Timeout = timeout ?? TimeSpan.FromSeconds(8), MaxResponseContentBufferSize = 2 * 1024 * 1024 };
    }
    static void ValidateHttp(Uri uri) { if (!new[] { "http", "https" }.Contains(uri.Scheme) || uri.UserInfo.Length > 0) throw new ArgumentException("Use um endereço HTTP/HTTPS sem credenciais na URL."); }
    public async Task<IReadOnlyList<OnvifProfile>> Profiles(CancellationToken cancel = default)
    {
        var capabilities = await Send(endpoint, new XElement(Device + "GetCapabilities", new XElement(Device + "Category", "All")), cancel);
        var ptzAddress = capabilities.Descendants(Schema + "PTZ").Elements(Schema + "XAddr").FirstOrDefault()?.Value ?? "";
        var address = capabilities.Descendants(Schema + "Media").Elements(Schema + "XAddr").FirstOrDefault()?.Value ?? throw new InvalidDataException("O dispositivo não informou o serviço Media ONVIF 1.");
        var mediaEndpoint = new Uri(address); ValidateHttp(mediaEndpoint);
        if (!mediaEndpoint.Host.Equals(endpoint.Host, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("O dispositivo informou um serviço Media em outro host. Confira o endereço ONVIF e a configuração de rede.");
        var profiles = await Send(mediaEndpoint, new XElement(Media + "GetProfiles"), cancel); var result = new List<OnvifProfile>();
        foreach (var p in profiles.Descendants(Media + "Profiles").Take(128))
        {
            var token = (string?)p.Attribute("token") ?? throw new InvalidDataException("Perfil ONVIF sem token."); var name = p.Element(Schema + "Name")?.Value ?? token;
            var stream = await Send(mediaEndpoint, new XElement(Media + "GetStreamUri", new XElement(Media + "StreamSetup", new XElement(Schema + "Stream", "RTP-Unicast"), new XElement(Schema + "Transport", new XElement(Schema + "Protocol", "RTSP"))), new XElement(Media + "ProfileToken", token)), cancel);
            var uri = stream.Descendants(Schema + "Uri").FirstOrDefault()?.Value ?? throw new InvalidDataException("O perfil não retornou uma URL de vídeo.");
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("rtsp" or "rtsps" or "http" or "https") || parsed.UserInfo.Length > 0) throw new InvalidDataException("URL de vídeo inválida ou com credenciais embutidas.");
            result.Add(new(token, name, uri, p.Element(Schema + "PTZConfiguration") is null ? "" : ptzAddress, p.Element(Schema + "VideoSourceConfiguration")?.Element(Schema + "SourceToken")?.Value ?? ""));
        }
        return result;
    }
    Uri PtzEndpoint(string address) { var uri = new Uri(address); ValidateHttp(uri); if (!uri.Host.Equals(endpoint.Host, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("O serviço PTZ informou outro host."); return uri; }
    public async Task MovePulse(string address, string token, float pan, float tilt, float zoom, CancellationToken cancel = default)
    {
        var uri = PtzEndpoint(address); var velocity = new XElement(Ptz + "Velocity");
        if (pan != 0 || tilt != 0) velocity.Add(new XElement(Schema + "PanTilt", new XAttribute("x", Math.Clamp(pan, -1, 1)), new XAttribute("y", Math.Clamp(tilt, -1, 1))));
        if (zoom != 0) velocity.Add(new XElement(Schema + "Zoom", new XAttribute("x", Math.Clamp(zoom, -1, 1))));
        try { await Send(uri, new XElement(Ptz + "ContinuousMove", new XElement(Ptz + "ProfileToken", token), velocity, new XElement(Ptz + "Timeout", "PT0.5S")), cancel); await Task.Delay(350, cancel); }
        finally { await StopPtz(address, token, CancellationToken.None); }
    }
    public async Task StopPtz(string address, string token, CancellationToken cancel = default) => await Send(PtzEndpoint(address), new XElement(Ptz + "Stop", new XElement(Ptz + "ProfileToken", token), new XElement(Ptz + "PanTilt", true), new XElement(Ptz + "Zoom", true)), cancel);
    async Task<XDocument> Send(Uri uri, XElement operation, CancellationToken cancel)
    {
        var header = new XElement(Soap + "Header");
        if (user.Length > 0)
        {
            var nonce = RandomNumberGenerator.GetBytes(20); var created = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
            var digest = Convert.ToBase64String(SHA1.HashData(nonce.Concat(Encoding.UTF8.GetBytes(created + password)).ToArray()));
            header.Add(new XElement(Security + "Security", new XAttribute(Soap + "mustUnderstand", "true"), new XElement(Security + "UsernameToken", new XElement(Security + "Username", user), new XElement(Security + "Password", new XAttribute("Type", "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"), digest), new XElement(Security + "Nonce", new XAttribute("EncodingType", "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"), Convert.ToBase64String(nonce)), new XElement(Utility + "Created", created))));
        }
        var envelope = new XDocument(new XElement(Soap + "Envelope", header, new XElement(Soap + "Body", operation)));
        using var request = new HttpRequestMessage(HttpMethod.Post, uri) { Content = new StringContent(envelope.ToString(SaveOptions.DisableFormatting), Encoding.UTF8, "application/soap+xml") };
        request.Content.Headers.ContentType!.Parameters.Add(new NameValueHeaderValue("action", "\"" + operation.Name.NamespaceName + "/" + operation.Name.LocalName + "\""));
        using var response = await http.SendAsync(request, cancel); var text = await response.Content.ReadAsStringAsync(cancel);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new UnauthorizedAccessException("Credenciais ONVIF recusadas pelo equipamento.");
        XDocument doc; try { using var reader = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024 }); doc = XDocument.Load(reader); } catch (XmlException) { throw new InvalidDataException("O equipamento respondeu com XML inválido."); }
        var fault = doc.Descendants(Soap + "Fault").FirstOrDefault(); if (fault is not null) throw new InvalidDataException("Falha SOAP ONVIF: " + (fault.Descendants(Soap + "Text").FirstOrDefault()?.Value ?? "sem descrição"));
        response.EnsureSuccessStatusCode(); return doc;
    }
    public void Dispose() => http.Dispose();
}
