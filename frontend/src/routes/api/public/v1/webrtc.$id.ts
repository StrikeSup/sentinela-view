import { createFileRoute } from "@tanstack/react-router";
import { cronometro } from "@/lib/server-timing";

// Consulta da resposta do Agent, renovação e encerramento da sessão WebRTC.
// Só o usuário que criou a sessão consegue lê-la, renová-la ou encerrá-la.
export const Route = createFileRoute("/api/public/v1/webrtc/$id")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request, params }) => {
        const t = cronometro();
        const { exigirUsuario, comCors } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        t.etapa("permissao");
        if (r.erro) return r.erro;
        const { lerSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return comCors(await lerSessaoWebrtc(t, params.id, r.auth.userId));
      },
      POST: async ({ request, params }) => {
        const { exigirUsuario, comCors } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        let corpo: { estado?: string; offer_sdp?: string } = {};
        try {
          corpo = (await request.json()) as { estado?: string; offer_sdp?: string };
        } catch {
          corpo = {};
        }
        const { renovarSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return comCors(await renovarSessaoWebrtc(params.id, r.auth.userId, corpo));
      },
      DELETE: async ({ request, params }) => {
        const { exigirUsuario, comCors } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        const { encerrarSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return comCors(await encerrarSessaoWebrtc(params.id, r.auth.userId));
      },
    },
  },
});
