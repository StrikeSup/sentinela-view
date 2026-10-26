import { createFileRoute } from "@tanstack/react-router";
import { cronometro } from "@/lib/server-timing";

export const Route = createFileRoute("/api/video/webrtc/$id")({
  server: {
    handlers: {
      /** Devolve a resposta SDP produzida pelo servidor local, quando pronta. */
      GET: async ({ request, params }) => {
        const t = cronometro();
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        t.etapa("auth_token");
        if (!auth) return t.aplicar(new Response("Não autorizado", { status: 401 }));
        const pode = await podeVisualizar(auth.userId);
        t.etapa("permissao");
        if (!pode) return t.aplicar(new Response("Sem permissão", { status: 403 }));
        const { lerSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return lerSessaoWebrtc(t, params.id, auth.userId);
      },

      /** Renova a validade da sessão enquanto a câmera continua aberta. */
      POST: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão", { status: 403 });
        let corpo: { estado?: string; offer_sdp?: string } = {};
        try {
          corpo = (await request.json()) as { estado?: string; offer_sdp?: string };
        } catch {
          corpo = {};
        }
        const { renovarSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return renovarSessaoWebrtc(params.id, auth.userId, corpo);
      },

      DELETE: async ({ request, params }) => {
        const { usuarioDaRequisicao } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        const { encerrarSessaoWebrtc } = await import("@/lib/webrtc-sinalizacao.server");
        return encerrarSessaoWebrtc(params.id, auth.userId);
      },
    },
  },
});
