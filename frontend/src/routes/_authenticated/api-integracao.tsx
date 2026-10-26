import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, HardDrive, Camera, Video } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { TesteApiImagem } from "@/components/TesteApiImagem";

export const Route = createFileRoute("/_authenticated/api-integracao")({
  head: () => ({
    meta: [
      { title: "API de integração — Sentinela VIEW" },
      {
        name: "description",
        content: "Links da API para empresas parceiras puxarem o vídeo ao vivo.",
      },
      { property: "og:title", content: "API de integração — Sentinela VIEW" },
      { property: "og:description", content: "Login, DVRs, câmeras e vídeo ao vivo por API." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApiPage,
});

function copiar(texto: string) {
  void navigator.clipboard.writeText(texto).then(() => toast.success("Copiado"));
}

function Bloco({ texto }: { texto: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 pr-12 text-xs">{texto}</pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-1 top-1 h-8 w-8"
        onClick={() => copiar(texto)}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ApiPage() {
  const { isMaster, loading } = useAuth();
  const [base, setBase] = useState("");
  const origem = base.replace(/\/api\/public\/v1\/?$/, "");
  useEffect(() => setBase(`${window.location.origin}/api/public/v1`), []);

  if (loading) return null;
  if (!isMaster)
    return (
      <p className="text-sm text-muted-foreground">Somente o usuário Master acessa esta tela.</p>
    );

  const partes = [
    {
      icone: KeyRound,
      titulo: "1. Login",
      metodo: "POST",
      url: `${base}/login`,
      texto:
        "Envia email e senha de um usuário do sistema e recebe o token (válido por cerca de 1 hora).",
      exemplo: `curl -X POST ${base}/login \\\n  -H "Content-Type: application/json" \\\n  -d '{"email":"empresa@exemplo.com","senha":"SENHA"}'`,
      resposta: `{ "token": "eyJ...", "expira_em": 1790000000, "tipo": "Bearer" }`,
    },
    {
      icone: HardDrive,
      titulo: "2. DVRs",
      metodo: "GET",
      url: `${base}/dvrs`,
      texto: "Lista os DVRs que o usuário pode ver.",
      exemplo: `curl ${base}/dvrs \\\n  -H "Authorization: Bearer TOKEN"`,
      resposta: `{ "dvrs": [ { "id": "...", "nome": "DVR 1", "canais": 16, "online": true } ] }`,
    },
    {
      icone: Camera,
      titulo: "3. Câmeras",
      metodo: "GET",
      url: `${base}/cameras?dvr_id=ID_DO_DVR`,
      texto: "Lista as câmeras (canais) de um DVR.",
      exemplo: `curl "${base}/cameras?dvr_id=ID_DO_DVR" \\\n  -H "Authorization: Bearer TOKEN"`,
      resposta: `{ "cameras": [ { "id": "...", "canal": 1, "nome": "Portaria", "online": true } ] }`,
    },
    {
      icone: Video,
      titulo: "4. Player ao vivo — uma única URL (recomendado, rápido)",
      metodo: "GET",
      url: `${origem}/player?dvr_id=ID_DO_DVR&canal=1#token=TOKEN`,
      texto:
        "Abra no navegador ou coloque num iframe. O player faz sozinho todo o fluxo WebRTC da Visualização (rede local primeiro, TURN se precisar, renovação e encerramento). O token vai depois do # e não é enviado ao servidor. Avisa a página via postMessage quando o primeiro quadro aparece. Só funciona em navegador.",
      exemplo: `<iframe src="${origem}/player?dvr_id=ID_DO_DVR&canal=1#token=TOKEN"\n  width="640" height="360" allow="autoplay"></iframe>\n\nwindow.addEventListener("message", (e) => {\n  if (e.data?.sentinela) console.log(e.data.evento, e.data.ms);\n});`,
      resposta: `{ "sentinela": true, "evento": "primeiro_quadro", "ms": 1500 }\n{ "sentinela": true, "evento": "erro", "motivo": "sem_video" }`,
    },
    {
      icone: Video,
      titulo: "4b. Imagem HLS (VLC, apps e servidores)",
      metodo: "GET",
      url: `${base}/imagem?dvr_id=ID_DO_DVR&canal=1`,
      texto:
        "Link HLS .m3u8 pela VPS. Mais lento na primeira abertura, mas funciona fora do navegador (VLC, apps, gravadores).",
      exemplo: `curl "${base}/imagem?dvr_id=ID_DO_DVR&canal=1" \\\n  -H "Authorization: Bearer TOKEN"`,
      resposta: `{ "estado": "publicando", "midia_pronta": true, "url_video": "https://.../index.m3u8" }`,
    },
    {
      icone: Video,
      titulo: "4c. Link RTSP (VLC, NVR e gravadores)",
      metodo: "GET",
      url: `${base}/rtsp?dvr_id=ID_DO_DVR&canal=1&minutos=60`,
      texto:
        "Devolve um link RTSP com o vídeo já pronto (o mesmo que o sistema recebe do Agent), retransmitido pela VPS. Não expõe usuário e senha do DVR. O link vale pelo tempo pedido em minutos (1–240, padrão 60) e pode ser aberto no VLC: Mídia → Abrir fluxo de rede. Por padrão a API espera até 20 s a câmera começar a transmitir e já devolve o link tocando; com aguardar=0 ela responde na hora e o VLC conecta assim que a imagem subir.",
      exemplo: `curl "${base}/rtsp?dvr_id=ID_DO_DVR&canal=1&minutos=60" \\\n  -H "Authorization: Bearer TOKEN"`,
      resposta: `{ "estado": "publicando", "rtsp": "rtsp://VPS:8554/sv_...?token=...", "expira_em": "..." }`,
    },
    {
      icone: Video,
      titulo: "5. Vídeo WebRTC (mesmo fluxo da Visualização)",
      metodo: "POST",
      url: `${base}/webrtc`,
      texto:
        "Vídeo direto do Agent para o navegador, sem passar pela VPS. Passos: GET /ice → cria a oferta no navegador (primeiro só STUN) → POST /webrtc → consulta GET /webrtc/{session_id} até vir answer_sdp → aplica. Se falhar ou ficar 20 s sem imagem, repete com TURN. Renove com POST /webrtc/{id} a cada 20 s e encerre com DELETE. Só funciona em navegador.",
      exemplo: `POST ${base}/webrtc\nAuthorization: Bearer TOKEN\n{ "dvr_id": "ID_DO_DVR", "canal": 1, "offer_sdp": "v=0...", "cliente_sessao": "player-123" }\n\nGET ${base}/webrtc/SESSION_ID`,
      resposta: `{ "session_id": "...", "expires_at": "..." }\n→ { "estado": "...", "etapa": "resposta_pronta", "answer_sdp": "v=0..." }`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="API de integração"
        description="Links para outras empresas puxarem o vídeo ao vivo das câmeras."
      />
      <Card className="mb-4">
        <CardContent className="space-y-2 pt-6 text-sm">
          <p className="font-medium">Endereço base da API</p>
          <Bloco texto={base} />
          <p className="text-muted-foreground">
            Crie um usuário para a empresa na tela de Usuários, com permissão de Visualização e só
            os clientes que ela pode ver. A empresa usa esse email e senha no Login.
          </p>
        </CardContent>
      </Card>
      <TesteApiImagem />
      <div className="grid gap-4 lg:grid-cols-2">
        {partes.map((p) => (
          <Card key={p.titulo}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <p.icone className="h-4 w-4" /> {p.titulo}
                <Badge variant="secondary">{p.metodo}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{p.texto}</p>
              <Bloco texto={p.url} />
              <p className="text-xs font-medium">Exemplo</p>
              <Bloco texto={p.exemplo} />
              <p className="text-xs font-medium">Resposta</p>
              <Bloco texto={p.resposta} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
