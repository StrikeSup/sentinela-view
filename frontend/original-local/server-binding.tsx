import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {center} from './data';
export function LocalServerBinding({server}:{server:any}){
 const [busy,setBusy]=useState(false);const qc=useQueryClient();
 if(server.id==='center')return null;
 return <button className="rounded border px-2 py-1 text-xs" disabled={busy||server.vinculado_local} onClick={async()=>{setBusy(true);try{await center('/local-servers/'+encodeURIComponent(server.id)+'/bind',{method:'POST'});await qc.invalidateQueries({queryKey:['servidores']});await qc.invalidateQueries({queryKey:['dvrs']});toast.success('Licença local atribuída a esta instalação.');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}}>{server.vinculado_local?'Vinculado a este computador':busy?'Vinculando…':'Vincular servidor'}</button>;
}
