using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using LibVLCSharp.Shared;
namespace IndependentCenter;
public sealed class GuardianWindow:Form
{
 readonly WebView2 web=new(){Dock=DockStyle.Fill};readonly NotifyIcon tray;bool quitting;readonly string address;
 GuardianNativeBridge? native;
 public GuardianWindow(string address,string? initialUrl=null,bool primary=true,LibVLC? engine=null,Func<Task<WebCatalog>>? catalog=null){
  this.address=address;Text="Sentinela VIEW — aplicativo e servidor local";Width=1360;Height=900;StartPosition=FormStartPosition.CenterScreen;
  var icon=Path.Combine(AppContext.BaseDirectory,"guardian.ico");if(File.Exists(icon))Icon=new Icon(icon);
  Controls.Add(web);var menu=new ContextMenuStrip();menu.Items.Add("Abrir Sentinela VIEW",null,(_,_)=>{Show();WindowState=FormWindowState.Normal;Activate();});
  menu.Items.Add(primary?"Encerrar servidor":"Fechar monitor",null,(_,_)=>{quitting=true;Close();});
  tray=new NotifyIcon{Icon=Icon,Text="Sentinela VIEW — servidor local ativo",ContextMenuStrip=menu,Visible=true};tray.DoubleClick+=(_,_)=>{Show();WindowState=FormWindowState.Normal;Activate();};
  FormClosing+=(_,e)=>{if(primary&&!quitting&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();tray.ShowBalloonTip(3000,"Sentinela VIEW","O servidor continua ativo na bandeja.",ToolTipIcon.Info);}};
  Shown+=async(_,_)=>{try{
   var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"IndependentCenter","GuardianWebView");
   var env=await CoreWebView2Environment.CreateAsync(userDataFolder:profile);await web.EnsureCoreWebView2Async(env);
   web.CoreWebView2.Settings.AreDevToolsEnabled=false;web.CoreWebView2.Settings.IsPasswordAutosaveEnabled=false;
   web.CoreWebView2.NavigationStarting+=(_,e)=>{if(!Allowed(e.Uri))e.Cancel=true;};
   web.CoreWebView2.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
   if(engine is not null && catalog is not null){
    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window,'sentinelaNative',{value:true,writable:false});");
    native=new GuardianNativeBridge(this,web,engine,catalog,address);
   }
   web.CoreWebView2.NewWindowRequested+=(_,e)=>{e.Handled=true;if(Allowed(e.Uri)){var child=new GuardianWindow(address,e.Uri,false,engine,catalog){Text="Sentinela VIEW — monitor adicional"};child.Show();}};
   web.Source=new Uri(initialUrl??address+"/auth");
  }catch(Exception){MessageBox.Show("Não foi possível abrir a interface. Verifique o Microsoft Edge WebView2 Runtime. O servidor permanece na bandeja.","Sentinela VIEW");}};
 }
 bool Allowed(string url)=>Uri.TryCreate(url,UriKind.Absolute,out var uri)&&uri.GetLeftPart(UriPartial.Authority)==address;
 protected override void Dispose(bool disposing){if(disposing){native?.Dispose();tray.Visible=false;tray.Dispose();web.Dispose();}base.Dispose(disposing);}
}
