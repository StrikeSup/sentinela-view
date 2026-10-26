import {cameraId} from './data';
type Entry={pc:RTCPeerConnection;stream:MediaStream|null;state:string;diag:any;listeners:Set<(s:any)=>void>;url:string;abort:AbortController;timer:any;closing:any;start:number};
const entries=new Map<string,Entry>();
const key=(d:string,c:number)=>`${d}:${c}`;
function emit(e:Entry){for(const listener of e.listeners)listener({estado:e.state,stream:e.stream,espelhado:false,diagnostico:{...e.diag,tempos:{...e.diag.tempos}}});}
function report(e:Entry){if(!e.diag.trace)return;void fetch(`/center-api/diagnostics/playback/${e.diag.trace}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({elapsedMs:performance.now()-e.start,frames:e.diag.framesDecoded,bytes:e.diag.bytesReceived,freezes:e.diag.congelamentos,reconnects:e.diag.reanexos,presented:e.diag.tempos.T8!==undefined,connected:e.pc.connectionState==="connected",retained:e.listeners.size===0,firstFrameMs:e.diag.tempos.T8??null})}).catch(()=>{});}
function close(e:Entry){e.pc.close();report(e);e.abort.abort();clearInterval(e.timer);clearTimeout(e.closing);e.pc.close();if(e.url)void fetch(e.url,{method:'DELETE',keepalive:true});}
function open(dvr:string,channel:number){
 const pc=new RTCPeerConnection({iceServers:[]});pc.addTransceiver('video',{direction:'recvonly'});
 const e:Entry={pc,stream:null,state:'iniciando',listeners:new Set(),url:'',abort:new AbortController(),timer:null,closing:null,start:performance.now(),diag:{chave:key(dvr,channel),sessionId:null,answerRecebido:false,bytesReceived:0,framesDecoded:0,packetsReceived:0,framesReceived:0,keyFramesDecoded:0,reanexos:0,ultimoFrameEm:null,answerAplicadoEm:null,motivoFallback:null,mensagemAgente:'Center local',rota:'LAN',tempos:{T0:0},marcosAgente:null,congelamentos:0,pedidosAtivos:1,conexoesAtivas:1,modoRelay:false,errosIce:[],tentativaId:crypto.randomUUID(),historico:[],faseIce:'direto',tentativaIce:1}};
 pc.ontrack=event=>{e.stream=new MediaStream([event.track]);emit(e);};
 pc.onconnectionstatechange=()=>{e.diag.connectionState=pc.connectionState;e.diag.iceConnectionState=pc.iceConnectionState;if(['failed','disconnected'].includes(pc.connectionState)){e.state='falha';e.diag.motivoFallback='Conexão interrompida. Use reconectar.';}emit(e);};
 e.timer=setInterval(async()=>{try{const stats=await pc.getStats();stats.forEach(s=>{if(s.type==='inbound-rtp'&&s.kind==='video'){for(const k of ['bytesReceived','framesDecoded','packetsReceived','framesReceived','keyFramesDecoded'])e.diag[k]=s[k]??0;e.diag.congelamentos=s.freezeCount??null;}});emit(e);if(performance.now()-(e.diag.lastReport??0)>5000){e.diag.lastReport=performance.now();report(e);}}catch{}},1000);
 void(async()=>{try{const id=await cameraId(dvr,channel);if(e.abort.signal.aborted)return;
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>((resolve,reject)=>{if(pc.iceGatheringState==='complete'){resolve();return;}const t=setTimeout(()=>reject(new Error('Falha ao preparar ICE local.')),8000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);resolve();}};});
  e.state='negociando';emit(e);
  const r=await fetch(`/center-api/cameras/${id}/whep`,{method:'POST',headers:{'Content-Type':'application/sdp'},body:pc.localDescription!.sdp,signal:e.abort.signal});
  e.diag.trace=r.headers.get("X-Diagnostic-Id");
  if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body.error||`Center retornou ${r.status}`);}
  e.url=(r.headers.get('Location')||'').replace(/^\/api\//,'/center-api/');if(!e.url.startsWith('/center-api/webrtc/'))throw new Error('Sessão inválida');
  if(e.abort.signal.aborted){void fetch(e.url,{method:'DELETE',keepalive:true});return;}
  await pc.setRemoteDescription({type:'answer',sdp:await r.text()});e.diag.answerAplicadoEm=new Date().toISOString();e.diag.answerRecebido=true;e.diag.sessionId=e.url;e.state='conectando';emit(e);
 }catch(error){if(!e.abort.signal.aborted){e.state='falha';e.diag.motivoFallback=(error as Error).message;emit(e);}}})();return e;
}
export function assinarWebrtc(d:string,c:number,listener:(s:any)=>void){const k=key(d,c);let e=entries.get(k);if(!e){e=open(d,c);entries.set(k,e);}clearTimeout(e.closing);e.listeners.add(listener);emit(e);return()=>{e!.listeners.delete(listener);if(!e!.listeners.size)e!.closing=setTimeout(()=>{close(e!);entries.delete(k);},250);};}
export function confirmarPrimeiroQuadro(d:string,c:number,q:any,video:HTMLVideoElement,method:string){const e=entries.get(key(d,c));if(e&&video.videoWidth>0&&e.diag.tempos.T8===undefined){e.diag.tempos.T8=performance.now()-e.start;e.diag.confirmacaoQuadro=method;e.state='ao-vivo';report(e);emit(e);}}
export function marcarEventoVideo(d:string,c:number,event:string){const e=entries.get(key(d,c));if(e)e.diag.tempos[event]=performance.now()-e.start;}
export async function reiniciarWebrtc(d:string,c:number){const k=key(d,c),e=entries.get(k);if(e){close(e);entries.delete(k);}}
export const rotuloFaseIce=()=> 'Local';
export type SnapshotWebrtc=any;


