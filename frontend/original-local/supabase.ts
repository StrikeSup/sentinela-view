import {center,mapped,clientId,invalidateCatalog} from './data';
let current:any=null;
const listeners=new Set<(event:string,session:any)=>void>();
async function refresh(){try{const me=await center('/me');current={user:{id:me.username,email:me.username,user_metadata:{}},access_token:'local-cookie',refresh_token:'local-cookie',role:me.role};}catch{current=null;}return current;}
function notify(event:string){listeners.forEach(fn=>fn(event,current));}
const auth={
 async getSession(){return {data:{session:await refresh()},error:null};},
 async getUser(){const s=await refresh();return {data:{user:s?.user??null},error:s?null:new Error('Não autenticado')};},
 async signInWithPassword({email,password}:any){try{await center('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:email,password})});await refresh();notify('SIGNED_IN');return {data:{session:current},error:null};}catch(e){return {data:null,error:e};}},
 async signOut(){await center('/logout',{method:'POST'});current=null;notify('SIGNED_OUT');return {error:null};},
 onAuthStateChange(fn:any){listeners.add(fn);queueMicrotask(()=>{void refresh().then(s=>fn('INITIAL_SESSION',s));});return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 async setSession(){return {data:{session:await refresh()},error:null};},
 async refreshSession(){return {data:{session:await refresh()},error:null};},
};
const localTables=new Set(['layouts_visualizacao','mosaicos','rondas','ronda_itens','layouts_deteccao','sessoes_usuario','telas_usuario','atividades_usuario']);
const emptyConfig=new Set(['user_permissions','user_clientes','perfis','fabricantes','sistemas']);
async function rows(table:string){if(!current)await refresh();if(!current)throw new Error('Não autenticado');
 if(table==='fabricantes')return ['Intelbras','Dahua','ONVIF'].map(nome=>({id:nome,nome,ativo:true}));
 const role=current.role==='Administrador'?'admin':current.role==='Operador'?'operador':'visualizador';
 if(table==='profiles')return [{id:current.user.id,nome:current.user.id,email:current.user.id,perfil_id:null,restaurar_sessao:false}];
 if(table==='user_roles')return [{user_id:current.user.id,role}];
 if(table==='clientes')return [{id:clientId,nome:'Center local',ativo:true,deteccoes:[]}];
 if(table==='servidores'){const servers=await center('/local-servers');return servers.some((s:any)=>s.vinculado_local)?servers:[{id:'center',nome:'Center neste computador (não vinculado)',cliente_id:clientId,clientes:{nome:'Center local'},online:true,ativo:true},...servers];}
 if(table==='licencas')return await center('/local-licenses');
 if(table==='dvrs'){const data=(await mapped()).dvrs;const connections=await center('/equipment/connections').catch(()=>null);return data.map(d=>({...d,conectado_via:connections===null?'Indisponível':connections.find((c:any)=>c.id===d.id)?.via||'Sem transmissão ativa'}));}
 if(table==='cameras')return (await mapped()).cameras;
 if(localTables.has(table))return JSON.parse(localStorage.getItem(key(table))||'[]');
 if(emptyConfig.has(table))return [];
 throw new Error(`O módulo ${table} ainda não tem integração local com o Center.`);
}
function key(table:string){return `guardian-center:${current?.user.id}:${table}`;}
class Query {
 filters:((r:any)=>boolean)[]=[]; singleRow=false; operation='read';value:any;sort='';ascending=true;maximum=Infinity;
 constructor(readonly table:string){}
 select(){return this;} order(field:string,opts?:any){this.sort=field;this.ascending=opts?.ascending!==false;return this;}
 eq(k:string,v:any){this.filters.push(r=>r[k]===v);return this;} neq(k:string,v:any){this.filters.push(r=>r[k]!==v);return this;}
 in(k:string,v:any[]){this.filters.push(r=>v.includes(r[k]));return this;}
 is(k:string,v:any){return this.eq(k,v);} limit(n:number){this.maximum=n;return this;} range(){return this;}
 like(k:string,v:string){const pattern=new RegExp('^'+v.split('%').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$');this.filters.push(r=>pattern.test(String(r[k]??'')));return this;}
 lt(k:string,v:any){this.filters.push(r=>r[k]<v);return this;} gt(k:string,v:any){this.filters.push(r=>r[k]>v);return this;}
 gte(k:string,v:any){this.filters.push(r=>r[k]>=v);return this;} lte(k:string,v:any){this.filters.push(r=>r[k]<=v);return this;}
 maybeSingle(){this.singleRow=true;return this;} single(){this.singleRow=true;return this;}
 insert(v:any){this.operation='insert';this.value=v;return this;} upsert(v:any){this.operation='upsert';this.value=v;return this;}
 update(v:any){this.operation='update';this.value=v;return this;} delete(){this.operation='delete';return this;}
 async run(){try{let all=await rows(this.table);const matches=(r:any)=>this.filters.every(f=>f(r));let data=all.filter(matches);
  if(this.table==='dvrs'&&this.operation==='insert'){
   const created=await center('/equipment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.value)});
   invalidateCatalog();return {data:this.singleRow?created:[created],error:null,count:1};
  }
  if(this.table==='servidores'&&this.operation==='insert'){
   const created=await center('/local-servers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.value)});
   return {data:this.singleRow?created:[created],error:null,count:1};
  }
  if(this.table==='dvrs'&&this.operation==='update'){
   if(data.length!==1)throw new Error('Selecione um DVR para editar.');
   if(!this.value.nome)throw new Error('Abra Editar DVR para salvar a configuração completa.');
   const updated=await center('/equipment/'+encodeURIComponent(data[0].id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.value)});
   invalidateCatalog();return {data:this.singleRow?updated:[updated],error:null,count:1};
  }
  if(this.operation!=='read'){
   // Validate the real session before every local change. No production data is written.
   if(!await refresh())throw new Error('Sessão encerrada.');
   if(!localTables.has(this.table))throw new Error('Cadastro de equipamentos e usuários: use o Center. Esta operação ainda não está integrada.');
   if(this.operation==='delete'){all=all.filter((r:any)=>!matches(r));data=[];}
   else if(this.operation==='update'){all=all.map((r:any)=>matches(r)?{...r,...this.value}:r);data=all.filter(matches);}
   else {data=(Array.isArray(this.value)?this.value:[this.value]).map((r:any)=>({id:crypto.randomUUID(),...r}));for(const row of data){const i=this.operation==='upsert'?all.findIndex((r:any)=>r.id===row.id):-1;if(i<0)all.push(row);else all[i]={...all[i],...row};}}
   localStorage.setItem(key(this.table),JSON.stringify(all));
  }
  if(this.sort)data.sort((a:any,b:any)=>String(a[this.sort]??'').localeCompare(String(b[this.sort]??''))*(this.ascending?1:-1));data=data.slice(0,this.maximum);
  return {data:this.singleRow?(data[0]??null):data,error:null,count:data.length};
 }catch(error){return {data:null,error,count:0};}}
 then(resolve:any,reject?:any){return this.run().then(resolve,reject);}
}
export const supabase:any={auth,supabaseUrl:'/center-local-disabled',supabaseKey:'',from:(table:string)=>new Query(table),
 channel:()=>{const channel:any={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=>{},send:async()=>{},track:async()=>{},presenceState:()=>({})};return channel;},
 removeChannel:async()=>{},removeAllChannels:async()=>{},
 rpc:async()=>({data:null,error:new Error('Operação de banco não integrada ao Center local.')}),
 functions:{invoke:async()=>({data:null,error:new Error('Serviço não disponível no modo local.')})},
 storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:''}}),upload:async()=>({error:new Error('Upload indisponível no modo local.')})})}
};
