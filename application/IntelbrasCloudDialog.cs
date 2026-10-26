using LibVLCSharp.Shared;
namespace IndependentCenter;

public sealed class IntelbrasCloudDialog : Form
{
    readonly CancellationTokenSource stop=new();
    public List<Camera> Cameras {get;}=[];
    public IntelbrasCloudDialog(string initialSerial="",string initialUser="",string initialPassword="",DeviceModel? model=null,int initialRtspPort=554)
    {
        Text="Intelbras Cloud — conexão e teste de imagem";ClientSize=new Size(690,560);StartPosition=FormStartPosition.CenterScreen;
        var serial=new TextBox{Left=150,Top=20,Width=280,Text=initialSerial};
        var user=new TextBox{Left=150,Top=60,Width=180,Text=initialUser};
        var password=new TextBox{Left=430,Top=60,Width=230,UseSystemPasswordChar=true,Text=initialPassword};
        var httpPort=new NumericUpDown{Left=150,Top=100,Width=80,Minimum=1,Maximum=65535,Value=80};
        var rtspPort=new NumericUpDown{Left=430,Top=100,Width=80,Minimum=1,Maximum=65535,Value=initialRtspPort};
        var status=new Label{Left=20,Top=145,Width=640,Height=65,Text="Usa o serviço Intelbras Cloud instalado neste computador. Informe as credenciais do equipamento; elas não são obtidas do DGuard."};
        var list=new CheckedListBox{Left=20,Top=215,Width=640,Height=190,DisplayMember="Name",CheckOnClick=true};
        var query=new Button{Left=20,Top=425,Width=190,Text="Conectar e consultar"};
        var preview=new Button{Left=225,Top=425,Width=190,Text="Testar primeira imagem",Enabled=false};
        var save=new Button{Left=430,Top=425,Width=230,Text="Adicionar selecionados",Enabled=false};
        var result=new Label{Left=20,Top=470,Width=640,Height=65};
        Controls.AddRange([serial,user,password,httpPort,rtspPort,status,list,query,preview,save,result]);
        void LabelAt(string text,int x,int y){Controls.Add(new Label{Text=text,Left=x,Top=y,Width=130});}
        LabelAt("Número de série",20,23);LabelAt("Usuário",20,63);LabelAt("Senha",350,63);LabelAt("Porta HTTP",20,103);LabelAt("Porta RTSP",300,103);
        Camera Make(OnvifProfile p)=>new(){Name=p.Name,Source=new UriBuilder(p.StreamUri){Host="127.0.0.1",Port=(int)rtspPort.Value}.Uri.AbsoluteUri,DeviceConnector="IntelbrasCloud",DeviceAddress="ibcloud://"+serial.Text.Trim().ToUpperInvariant()+"/",User=user.Text,Password=password.Text,Group="Intelbras Cloud",VendorId=model?.VendorId,ModelId=model?.Id,ProfileToken=p.Token,ChannelToken=p.VideoSourceToken};
        void EnableFields(bool value){serial.Enabled=user.Enabled=password.Enabled=httpPort.Enabled=rtspPort.Enabled=value;query.Enabled=value;}
        query.Click+=async(_,_)=>{
            EnableFields(false);list.Items.Clear();save.Enabled=preview.Enabled=false;result.Text="Abrindo túnel cloud…";
            try{
                await using var cloud=new IntelbrasCloudSession(serial.Text.Trim());int local=await cloud.OpenPort((int)httpPort.Value,stop.Token);
                result.Text="Túnel aberto. Autenticando no equipamento…";
                using var cgi=new DahuaHttpClient("http://127.0.0.1:"+local,user.Text,password.Text,TimeSpan.FromSeconds(20));
                var configuredRtsp=await cgi.ReadRtspPort(stop.Token);
                if(configuredRtsp.HasValue)rtspPort.Value=configuredRtsp.Value;
                File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"intelbras-cloud-port-test.txt"),"Device RTSP port: "+(configuredRtsp?.ToString()??"not reported")+"; UTC="+DateTimeOffset.UtcNow.ToString("O"));
                int streams=model?.Original.TryGetProperty("streamsCount",out var s)==true?s.GetInt32():2;
                int? capacity=model?.Original.TryGetProperty("camerasCount",out var n)==true&&n.GetInt32()>0?n.GetInt32():null;
                foreach(var p in await cgi.Profiles((int)rtspPort.Value,Math.Clamp(streams,1,3),stop.Token,capacity))list.Items.Add(p,p.Token.EndsWith("stream:0"));
                result.Text="Autenticação e consulta concluídas. Teste a imagem antes de adicionar.";preview.Enabled=list.Items.Count>0;
            }catch(Exception e){result.Text=e is OperationCanceledException?"Consulta cancelada ou tempo esgotado.":e.Message;}
            finally{if(!IsDisposed)EnableFields(true);}
        };
        preview.Click+=async(_,_)=>{
            EnableFields(false);preview.Enabled=save.Enabled=false;result.Text="Aguardando um quadro real pelo cloud…";
            try{
                Core.Initialize();using var engine=new LibVLC("--quiet","--no-plugins-cache");using var hub=new WebFrameHub(engine);
                var camera=Make((OnvifProfile)list.Items[0]);byte[]? frame=null;var deadline=DateTime.UtcNow.AddSeconds(50);
                while(DateTime.UtcNow<deadline && frame is null){stop.Token.ThrowIfCancellationRequested();frame=hub.Frame(camera);await Task.Delay(300,stop.Token);}
                if(frame is not {Length:>1000})throw new IOException("O túnel abriu, mas não chegou imagem. Verifique porta RTSP, credenciais e suporte RTSP do modelo.");
                result.Text="Imagem real recebida e decodificada pelo player. Pronto para adicionar.";save.Enabled=true;
                File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"intelbras-cloud-live-test.txt"),"PASS authenticated CGI over cloud; PASS real RTSP video decoded. UTC="+DateTimeOffset.UtcNow.ToString("O"));
                using var viewer=new Form{Text="Prévia ao vivo — "+camera.Name,ClientSize=new Size(960,580),StartPosition=FormStartPosition.CenterParent};
                hub.Dispose(); // Release the validation decoder before continuous playback.
                using var cell=new VideoCell(engine){Dock=DockStyle.Fill};
                var hint=new Label{Dock=DockStyle.Bottom,Height=36,Text="Reprodução contínua. Feche a prévia para adicionar os canais ao Center.",TextAlign=ContentAlignment.MiddleCenter};
                viewer.Controls.Add(cell);viewer.Controls.Add(hint);
                cell.Assign(camera);
                viewer.Shown+=(_,_)=>cell.Play(engine);
                viewer.ShowDialog(this);
                cell.Stop();
            }catch(Exception e){result.Text=e.Message;File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"intelbras-cloud-live-test.txt"),"FAIL image not validated; "+e.GetType().Name);}
            finally{if(!IsDisposed){EnableFields(true);preview.Enabled=true;}}
        };
        save.Click+=(_,_)=>{foreach(OnvifProfile p in list.CheckedItems)Cameras.Add(Make(p));if(Cameras.Count>0)DialogResult=DialogResult.OK;};
        foreach(var input in new[]{serial,user,password})input.TextChanged+=(_,_)=>{list.Items.Clear();save.Enabled=preview.Enabled=false;};
        httpPort.ValueChanged+=(_,_)=>{list.Items.Clear();save.Enabled=preview.Enabled=false;};rtspPort.ValueChanged+=(_,_)=>save.Enabled=false;
        CenterTheme.Apply(this);
    }
    protected override void Dispose(bool disposing){if(disposing){stop.Cancel();}base.Dispose(disposing);}
}


