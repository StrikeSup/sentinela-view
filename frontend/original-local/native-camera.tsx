import {useEffect,useRef,useState} from 'react';
import {CameraAoVivo as BrowserCamera} from 'guardian-original-camera';
import {cameraId} from './data';

const slots=new Map<string,{element:HTMLElement;camera:string;quality:string;contain:boolean}>();
const bridge=()=> (window as any).sentinelaNative && (window as any).chrome?.webview;
let timer:ReturnType<typeof setInterval>|undefined;
let lastLayout='',lastSent=0;
function painted(e:Element){for(let p:Element|null=e;p;p=p.parentElement){const c=getComputedStyle(p);if(c.visibility==='hidden'||c.display==='none'||Number(c.opacity)===0)return false;}return true;}
function publish(){
 const host=bridge();if(!host)return;
 const modal=Array.from(document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"][data-state="open"]')).some(e=>e.getClientRects().length>0);
 const cutouts=Array.from(document.querySelectorAll('button,[role=button],.absolute')).filter(e=>painted(e)&&!e.querySelector('[data-native-surface]')&&!e.hasAttribute('data-native-surface')).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0&&r.height<100).slice(0,300);
 const message={cutouts,type:'native-layout',viewportWidth:innerWidth,viewportHeight:innerHeight,pixelRatio:devicePixelRatio,slots:Array.from(slots,([key,s])=>{
  const r=s.element.getBoundingClientRect();
  const shown=!modal&&!document.hidden&&getComputedStyle(s.element).visibility!=='hidden'&&r.width>1&&r.height>1&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
  return {key,camera:s.camera,quality:s.quality,contain:s.contain,x:r.x,y:r.y,width:r.width,height:r.height,visible:shown};
 })};
 const serialized=JSON.stringify(message),now=performance.now();
 if(serialized!==lastLayout||now-lastSent>750){host.postMessage(message);lastLayout=serialized;lastSent=now;}
}
export function CameraAoVivo(props:any){
 if(!bridge())return <BrowserCamera {...props}/>;
 return <NativeCamera {...props}/>;
}
function NativeCamera({dvrId,canal,segundoPlano=false,qualidade='extra',contido=false}:any){
 const element=useRef<HTMLDivElement>(null);const key=useRef(crypto.randomUUID());
 const [state,setState]=useState('Conectando…');
 useEffect(()=>{
  let active=true,first=false;
  const host=bridge();
  const receive=(event:any)=>{
   if(event.data?.type==='native-hover'){
    element.current?.closest('[class~="group/tile"]')?.toggleAttribute('data-native-hover',event.data.key===key.current);publish();return;
   }
   if(event.data?.type==='native-pointer'&&event.data.key===key.current&&element.current){
    const r=element.current.getBoundingClientRect();element.current.dispatchEvent(new MouseEvent(event.data.kind,{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:event.data.kind==='contextmenu'?2:0}));return;
   }
   if(event.data?.type!=='native-status')return;
   const s=event.data.slots?.find((x:any)=>x.key===key.current);if(!s)return;
   setState(s.fresh?'Ao vivo · nativo':'Conectando / recuperando imagem…');
   if(s.fresh&&!first){first=true;window.dispatchEvent(new CustomEvent('sentinela:primeiro-quadro',{detail:{dvrId,canal}}));}
  };
  host.addEventListener('message',receive);
  void cameraId(dvrId,canal).then(camera=>{if(!active||!element.current)return;slots.set(key.current,{element:element.current,camera,quality:qualidade,contain:contido});if(!timer)timer=setInterval(publish,100);publish();}).catch(()=>setState('Entre novamente ou atualize o cadastro.'));
  return()=>{active=false;host.removeEventListener('message',receive);slots.delete(key.current);publish();if(!slots.size){clearInterval(timer);timer=undefined;}};
 },[dvrId,canal,qualidade,contido]);
 return <div className="relative h-full w-full bg-black" style={{visibility:segundoPlano?'hidden':undefined}}>
  <div ref={element} data-native-surface className="absolute inset-0"/>
  {state!=='Ao vivo · nativo' && <div className="absolute bottom-8 left-2 text-xs text-white bg-black/70 px-2">{state}</div>}
  <style>{`[data-native-hover] > .absolute {opacity:1 !important}`}</style>
 </div>;
}

