export const clientId='center-local';
export async function center(path:string, init?:RequestInit){
 const r=await fetch('/center-api'+path,{credentials:'same-origin',...init});
 if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(r.status===401?'Entre novamente com a conta do Center.':body.error||`Center indisponível (${r.status}).`);}
 return r.status===204?null:r.json();
}
let pending:Promise<any>|null=null, until=0;
export function catalog(){if(!pending||Date.now()>until){until=Date.now()+2000;pending=center('/cameras').catch(e=>{pending=null;throw e;});}return pending;}
export function invalidateCatalog(){pending=null;until=0;}
export async function mapped(){const data=await catalog(); const dvrs:any[]=[];const cameras:any[]=[];
 for(const c of data.cameras){const id=c.equipmentId||c.id;let d=dvrs.find(x=>x.id===id);
  if(!d){d={id,nome:c.group||c.name,cliente_id:clientId,servidor_id:'center',canais:0,online:null,fabricante:c.connector,clientes:{nome:'Center local'},servidores:{nome:'Center neste computador'},status:'Não monitorado'};dvrs.push(d);}
  cameras.push({...c,dvr_id:id,canal:++d.canais,nome:c.name,online:null});
 }
 const saved=await center('/equipment');
 for(const d of dvrs){d.ativo=true;Object.assign(d,saved.find((x:any)=>x.id===d.id)||{});}
 const bound=(await center('/local-servers')).find((s:any)=>s.vinculado_local);
 if(bound)for(const d of dvrs){d.servidor_id=bound.id;d.servidores={nome:bound.nome};}
 return {dvrs,cameras};
}
export async function cameraId(dvr:string,channel:number){const data=await mapped();const c=data.cameras.find(x=>x.dvr_id===dvr&&x.canal===channel);if(!c)throw new Error('Canal não encontrado no Center.');return c.id;}
