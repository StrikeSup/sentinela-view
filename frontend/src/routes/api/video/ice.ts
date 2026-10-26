import { createFileRoute } from "@tanstack/react-router";

/**
 * Entrega ao navegador a lista de servidores ICE (STUN/TURN), com credenciais
 * temporárias. O segredo nunca vai para o navegador.
 */
export const Route = createFileRoute("/api/video/ice")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão para visualizar câmeras", { status: 403 });
        const { montarIceServers } = await import("@/lib/webrtc-sinalizacao.server");
        return Response.json(await montarIceServers(auth.userId), {
          headers: { "Cache-Control": "private, no-store" },
        });
      },
    },
  },
});
