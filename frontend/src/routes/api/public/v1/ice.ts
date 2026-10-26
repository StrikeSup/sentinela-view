import { createFileRoute } from "@tanstack/react-router";

// Servidores ICE (STUN/TURN) para o player WebRTC da empresa parceira.
// Mesma lista e mesmas credenciais temporárias da Visualização.
export const Route = createFileRoute("/api/public/v1/ice")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request }) => {
        const { exigirUsuario, CORS } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        const { montarIceServers } = await import("@/lib/webrtc-sinalizacao.server");
        return Response.json(await montarIceServers(r.auth.userId), {
          headers: { ...CORS, "Cache-Control": "private, no-store" },
        });
      },
    },
  },
});
