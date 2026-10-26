using IntegrationService.COMIBCloudClient;
using Grpc.Net.Client;
using Grpc.Core;
using Google.Protobuf.WellKnownTypes;

namespace IndependentCenter;

// Uses the installed IntegrationService contract. Does not extract SDK registration keys.
// Worker.OnPortReqTimer returns the SDK result (local tunnel port) in PRemotePort.
public sealed class IntelbrasCloudSession : IAsyncDisposable
{
    readonly GrpcChannel channel = GrpcChannel.ForAddress("http://127.0.0.1:21777");
    readonly IBCloud.IBCloudClient client;
    readonly long owner = Random.Shared.NextInt64(1,long.MaxValue);
    readonly CancellationTokenSource lifetime = new();
    readonly SemaphoreSlim gate = new(1,1);
    readonly Dictionary<int,int> ports = [];
    readonly string serial;
    uint worker;
    Task? heartbeat;
    bool disposed;
    public IntelbrasCloudSession(string serial)
    {
        if(string.IsNullOrWhiteSpace(serial) || serial.Length>64 || !serial.All(c=>char.IsAsciiLetterOrDigit(c)||c=='-')) throw new ArgumentException("Número de série Intelbras inválido.");
        this.serial=serial; client=new(channel);
    }
    public async Task<int> OpenPort(int remotePort,CancellationToken cancellation=default)
    {
        if(remotePort is <1 or >65535) throw new ArgumentOutOfRangeException(nameof(remotePort));
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation,lifetime.Token); timeout.CancelAfter(TimeSpan.FromSeconds(75));
        var token=timeout.Token;
        await gate.WaitAsync(token).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(ports.TryGetValue(remotePort,out var existing))return existing;
            if(worker==0)
            {
                using var available=client.GetAvailableWorkerResponseStream(new Empty(),cancellationToken:token);
                var read=ReadWorker(available.ResponseStream,token);
                await client.GetAvailableWorkerAsync(new GetAvailableWorkerRequest{UserID=owner,UserPointer=owner,CanCreate=true,CWReq=new CreateWorkerRequest{MaxUsers=1}},cancellationToken:token).ResponseAsync.ConfigureAwait(false);
                var allocation=await read.ConfigureAwait(false); worker=allocation.WorkerID;
                if(worker==0)throw new IOException("O serviço não disponibilizou uma sessão cloud.");
                if(allocation.CurrentWorkerState.ToString()!="WcsInitialized") {
                    var registration=await client.RegisterAndConfigLogAsync(new RegisterAndConfigLogRequest{WorkerID=worker,Type=0,Level=0},cancellationToken:token).ResponseAsync.ConfigureAwait(false);
                    if(registration.Result<0)throw new IOException("Registro do SDK cloud recusado: "+registration.Result);
                    var init=await client.InitAsync(new InitRequest{WorkerID=worker},cancellationToken:token).ResponseAsync.ConfigureAwait(false);
                    if(init.Result<0)throw new IOException("Inicialização do SDK cloud recusada: "+init.Result);
                }
                heartbeat=KeepAlive();
            }
            using var stream=client.AddPortSubscribe(new Empty(),cancellationToken:token);
            var pending=ReadPort(stream.ResponseStream,token);
            var queued=await client.AddPortAsync(new AddPortRequest{WorkerID=worker,Uuid=serial,PRemotePort=remotePort,PLocalPort=0,PUseRelay=true,PUserPointer=owner},cancellationToken:token).ResponseAsync.ConfigureAwait(false);
            if(!queued.Result)throw new IOException("O serviço cloud recusou a abertura da porta.");
            var result=await pending.ConfigureAwait(false);
            // Despite its name, this field holds IBCloud2AddPort's return value, not the requested remote port.
            int local=result.PRemotePort;
            if(local is <1 or >65535)throw new IOException("Não foi possível abrir o túnel Intelbras Cloud. Código: "+local);
            ports.Add(remotePort,local); return local;
        }
        finally {gate.Release();}
    }
    async Task<GetAvailableWorkerResponse> ReadWorker(IAsyncStreamReader<GetAvailableWorkerResponse> stream,CancellationToken token)
    {while(await stream.MoveNext(token).ConfigureAwait(false)){if(stream.Current.UserPointer==owner)return stream.Current;}throw new IOException("Fluxo de sessão cloud encerrado.");}
    async Task<AddPortStreamResponse> ReadPort(IAsyncStreamReader<AddPortStreamResponse> stream,CancellationToken token)
    {while(await stream.MoveNext(token).ConfigureAwait(false)){if(stream.Current.PUserPointer==owner && stream.Current.Uuid==serial)return stream.Current;}throw new IOException("Fluxo de porta cloud encerrado.");}
    async Task KeepAlive()
    {
        try {using var timer=new PeriodicTimer(TimeSpan.FromSeconds(10));while(await timer.WaitForNextTickAsync(lifetime.Token).ConfigureAwait(false))await client.SendWorkerKeepAliveAsync(new KeepAliveRequest{WorkerID=worker},deadline:DateTime.UtcNow.AddSeconds(5),cancellationToken:lifetime.Token).ResponseAsync.ConfigureAwait(false);}
        catch(OperationCanceledException){} catch(RpcException){}
    }
    public async ValueTask DisposeAsync()
    {
        if(disposed)return; disposed=true; lifetime.Cancel();
        await gate.WaitAsync().ConfigureAwait(false);
        try {
            if(heartbeat is not null)await heartbeat.ConfigureAwait(false);
            if(worker!=0) {
                foreach(var port in ports.Values)try{await client.DelPortAsync(new DelPortRequest{WorkerID=worker,Uuid=serial,PPort=port,UserPointer=owner},deadline:DateTime.UtcNow.AddSeconds(3)).ResponseAsync.ConfigureAwait(false);}catch(RpcException){}
                try{await client.UngetWorkerAsync(new UngetWorkerRequest{WorkerID=worker,UserID=owner},deadline:DateTime.UtcNow.AddSeconds(3)).ResponseAsync.ConfigureAwait(false);}catch(RpcException){}
            }
        } finally {channel.Dispose();lifetime.Dispose();gate.Release();}
    }
}
