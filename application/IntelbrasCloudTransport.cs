using System.Net;
using System.Net.Sockets;
namespace IndependentCenter;

// Loopback endpoints remain stable for each player while cloud setup runs asynchronously.
public static class IntelbrasCloudTransport
{
    static readonly object gate=new();
    static readonly Dictionary<string,Proxy> proxies=[];
    public static async Task<string> Prepare(Camera camera, CancellationToken cancellation)
    {
        var source=Resolve(camera);
        if(camera.DeviceConnector!="IntelbrasCloud")return source;
        var key=new Uri(camera.DeviceAddress).Host.ToUpperInvariant()+":"+new Uri(camera.Source).Port;
        Proxy proxy;lock(gate)proxy=proxies[key];
        await proxy.Ready(cancellation).ConfigureAwait(false);
        return source;
    }
    public static string Resolve(Camera camera)
    {
        if(camera.DeviceConnector!="IntelbrasCloud")return camera.Source;
        var source=new Uri(camera.Source); var device=new Uri(camera.DeviceAddress);
        if(device.Scheme!="ibcloud" || source.Scheme!="rtsp")throw new InvalidDataException("Endereço cloud inválido.");
        var serial=device.Host.ToUpperInvariant();int remote=source.Port>0?source.Port:554;
        lock(gate){var key=serial+":"+remote;if(!proxies.TryGetValue(key,out var proxy)){proxy=new(serial,remote);proxies.Add(key,proxy);}return new UriBuilder(source){Host="127.0.0.1",Port=proxy.Port}.Uri.AbsoluteUri;}
    }
    public static async Task Shutdown()
    {Proxy[] items;lock(gate){items=proxies.Values.ToArray();proxies.Clear();}foreach(var item in items)await item.DisposeAsync().ConfigureAwait(false);}
    sealed class Proxy : IAsyncDisposable
    {
        readonly TcpListener listener=new(IPAddress.Loopback,0);
        readonly IntelbrasCloudSession session;
        readonly int remote;
        readonly CancellationTokenSource stop=new();
        readonly Task accepting;
        readonly System.Collections.Concurrent.ConcurrentDictionary<long,Task> connections=new();long counter;
        public int Port=>((IPEndPoint)listener.LocalEndpoint).Port;
        public Task<int> Ready(CancellationToken token)=>session.OpenPort(remote,token);
        public Proxy(string serial,int remote){this.remote=remote;session=new(serial);listener.Start();accepting=Accept();}
        async Task Accept()
        {
            try{while(!stop.IsCancellationRequested){var socket=await listener.AcceptTcpClientAsync(stop.Token).ConfigureAwait(false);long id=Interlocked.Increment(ref counter);var task=Forward(socket);connections[id]=task;_ = task.ContinueWith(_=>connections.TryRemove(id,out var ignored),TaskScheduler.Default);}}
            catch(OperationCanceledException){}catch(SocketException)when(stop.IsCancellationRequested){}
        }
        async Task Forward(TcpClient downstream)
        {
            using(downstream)using(var upstream=new TcpClient())using(var cancel=CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
            try{
                int port=await session.OpenPort(remote,cancel.Token).ConfigureAwait(false);
                await upstream.ConnectAsync(IPAddress.Loopback,port,cancel.Token).ConfigureAwait(false);
                var a=downstream.GetStream().CopyToAsync(upstream.GetStream(),cancel.Token);
                var b=upstream.GetStream().CopyToAsync(downstream.GetStream(),cancel.Token);
                await Task.WhenAny(a,b).ConfigureAwait(false);cancel.Cancel();
                try{await Task.WhenAll(a,b).ConfigureAwait(false);}catch(OperationCanceledException){}
            }catch(Exception e)when(e is IOException or SocketException or OperationCanceledException or Grpc.Core.RpcException){}
        }
        public async ValueTask DisposeAsync(){stop.Cancel();listener.Stop();await accepting.ConfigureAwait(false);await Task.WhenAll(connections.Values.ToArray()).ConfigureAwait(false);await session.DisposeAsync().ConfigureAwait(false);stop.Dispose();}
    }
}
