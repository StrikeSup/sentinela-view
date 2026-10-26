using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Diagnostics;
namespace IndependentCenter;

// Local integration fixture only: FFmpeg packetizes H264, this adapter serves RTSP/TCP.
sealed class RtspFixture : IDisposable
{
    readonly TcpListener listener=new(IPAddress.Loopback,18554);
    readonly CancellationTokenSource stop=new();
    readonly Task worker;
    public RtspFixture() { listener.Start(); worker=Serve(); }
    async Task Serve()
    {
        try
        {
            using var client=await listener.AcceptTcpClientAsync(stop.Token); using var stream=client.GetStream();
            using var reader=new StreamReader(stream,Encoding.ASCII,leaveOpen:true);
            while(!stop.IsCancellationRequested)
            {
                var line=await reader.ReadLineAsync(stop.Token); if(line is null)return;
                var method=line.Split(' ')[0]; var seq="1";
                while(!string.IsNullOrEmpty(line=await reader.ReadLineAsync(stop.Token))) if(line.StartsWith("CSeq:",StringComparison.OrdinalIgnoreCase))seq=line[5..].Trim();
                string body="",headers="Session: 12345678\r\n";
                if(method=="DESCRIBE") { body="v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Local fixture\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=control:*\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1\r\na=control:trackID=0\r\n";headers+="Content-Type: application/sdp\r\nContent-Base: rtsp://127.0.0.1:18554/cam/realmonitor/\r\n"; }
                if(method=="SETUP")headers+="Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n";
                if(method=="OPTIONS")headers+="Public: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes($"RTSP/1.0 200 OK\r\nCSeq: {seq}\r\n{headers}Content-Length: {Encoding.ASCII.GetByteCount(body)}\r\n\r\n{body}"),stop.Token);
                if(method=="TEARDOWN")return;
                if(method!="PLAY")continue;
                using var udp=new UdpClient(new IPEndPoint(IPAddress.Loopback,0)); var port=((IPEndPoint)udp.Client.LocalEndPoint!).Port;
                var start=new ProcessStartInfo("ffmpeg.exe") { UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardError=true };
                foreach(var arg in new[]{"-hide_banner","-loglevel","error","-re","-stream_loop","-1","-i",Path.Combine(AppContext.BaseDirectory,"demo.mp4"),"-an","-c:v","copy","-bsf:v","h264_mp4toannexb","-f","rtp","-payload_type","96",$"rtp://127.0.0.1:{port}?pkt_size=1200"})start.ArgumentList.Add(arg);
                using var ffmpeg=Process.Start(start) ?? throw new IOException("FFmpeg fixture failed");
                var errors=ffmpeg.StandardError.ReadToEndAsync();
                try { while(!stop.IsCancellationRequested) { var packet=(await udp.ReceiveAsync(stop.Token)).Buffer; var frame=new byte[4+packet.Length];frame[0]=36;frame[1]=0;frame[2]=(byte)(packet.Length>>8);frame[3]=(byte)packet.Length;packet.CopyTo(frame,4);await stream.WriteAsync(frame,stop.Token); } }
                finally { if(!ffmpeg.HasExited)ffmpeg.Kill();await ffmpeg.WaitForExitAsync();await errors; }
                return;
            }
        }
        catch(Exception e) when(e is OperationCanceledException or IOException or SocketException or ObjectDisposedException) { }
    }
    public void Dispose() { stop.Cancel();listener.Stop();try{worker.GetAwaiter().GetResult();}finally{stop.Dispose();} }
}
