import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const local=(p:string)=>fileURLToPath(new URL('./original-local/'+p,import.meta.url));
export default defineConfig({envDir:'./original-local/no-env',plugins:[{
 name:'local-adapters',enforce:'pre',resolveId(id){
  if(id==='guardian-original-camera')return fileURLToPath(new URL('./src/components/CameraAoVivo.tsx',import.meta.url));
  if(id==='local-server-binding')return local('server-binding.tsx');
  if(id.endsWith('settings.functions'))return local('settings.ts');
  if(/\/(monitoramento|agente|usuarios)\.functions$/.test(id))return local('functions.ts');
 },transform(code,id){
  if(id.replaceAll('\\','/').endsWith('/src/routes/_authenticated/servidores.tsx'))code='import {LocalServerBinding} from "local-server-binding";\n'+code.replace('<Button variant="ghost" size="icon" title="Histórico de licenças"','<LocalServerBinding server={s} /><Button variant="ghost" size="icon" title="Histórico de licenças"').replace('Vincule a licença gerada pelo servidor para que ele saiba quais DVRs deve subir.','Modo local: crie um servidor e clique em Vincular servidor para atribuir a licença local a esta instalação. Não ativa licenças de produção.');
  if(id.replaceAll('\\','/').endsWith('/src/routes/_authenticated/dvrs.tsx'))code=code.replace('<p className="font-medium">{d.nome}</p>','<p className="font-medium">{d.nome}</p><p className="text-xs text-muted-foreground">Conectado via: {(d as any).conectado_via}</p>');
  if(id.replaceAll('\\','/').endsWith('/src/routes/_authenticated/dvrs.tsx'))return code.replace('if ((anterior as { fuso_horario?: string | null } | undefined)?.fuso_horario !== payload.fuso_horario) {','if (false) {').replace('<DialogTitle>{form.id ? "Editar DVR" : "Novo DVR"}</DialogTitle>','<DialogTitle>{form.id ? "Editar DVR" : "Novo DVR"}</DialogTitle><p className="text-sm">Cadastro local: arraste a prioridade e preencha as conexões disponíveis (IP interno, externo ou Cloud do fabricante Intelbras). Salvar autentica e consulta os canais; aguarde até 90 segundos. A abertura WebRTC tenta as rotas na ordem. Porta de serviço, gravação e ajuste de horário ainda não são aplicados. Na edição, senha vazia mantém a senha salva.</p>').replace('Arraste os blocos para definir a ordem de prioridade da conexão (1, 2 e 3).','Arraste os blocos para definir a ordem. Rotas vazias são ignoradas; para Cloud, informe o serial e a porta HTTP.');
  if(id.replaceAll('\\','/').endsWith('/src/routes/auth.tsx'))return code.replace('type="email"','type="text"').replaceAll('E-mail','Usuário do Center').replaceAll('seu@email.com','Usuário').replaceAll('"/dashboard"','"/visualizacao"');
  if(id.replaceAll('\\','/').endsWith('/src/routes/_authenticated/dashboard.tsx'))return code.replace('filter((d) => !d.online)','filter((d) => d.online === false)').replace('titulo="DVRs offline" valor={dvrsOffline}','titulo="DVRs offline" valor="Não monitorado"');
  return code;
 },configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:5190'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5190')){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:5190; font-src 'self' data:");
  if(req.url?.startsWith('/api/')||req.url?.startsWith('/center-local-disabled/')){res.statusCode=501;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Recurso ainda não integrado ao Center local.'}));return;}
  next();
 });}
 },react(),tailwind()],resolve:{alias:[
 {find:'@/components/CameraAoVivo',replacement:local('native-camera.tsx')},
 {find:'@/integrations/supabase/client',replacement:local('supabase.ts')},
 {find:'@/lib/webrtc-manager',replacement:local('webrtc.ts')},
 {find:'@tanstack/react-start',replacement:local('start.ts')},
 {find:'@',replacement:fileURLToPath(new URL('./src',import.meta.url))}
 ]},server:{host:'127.0.0.1',port:5190,strictPort:true,proxy:{'/center-api':{target:'http://127.0.0.1:8095',changeOrigin:true,rewrite:p=>p.replace(/^\/center-api/,'/api'),configure(proxy){proxy.on('proxyReq',req=>req.setHeader('Origin','http://127.0.0.1:8095'));}}}},build:{outDir:'dist-guardian-original'}});
