import { createFileRoute } from "@tanstack/react-router";
import { cronometro } from "@/lib/server-timing";

// Sinalização WebRTC intermediada pelo painel. A lógica fica em
// webrtc-sinalizacao.server.ts, compartilhada com a API das empresas parceiras.
export const Route = createFileRoute("/api/video/webrtc")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t = cronometro();
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        t.etapa("auth_token");
        if (!auth) return t.aplicar(new Response("Não autorizado", { status: 401 }));
        const pode = await podeVisualizar(auth.userId);
        t.etapa("permissao");
        if (!pode)
          return t.aplicar(new Response("Sem permissão para visualizar câmeras", { status: 403 }));

        // O corpo só é lido depois de autenticação e permissão.
        let corpoV: unknown = null;
        try {
          corpoV = await request.json();
        } catch {
          return t.aplicar(new Response("JSON inválido", { status: 400 }));
        }
        const { corpoOfertaSchema, iniciarSessaoWebrtc } =
          await import("@/lib/webrtc-sinalizacao.server");
        const parsed = corpoOfertaSchema.safeParse(corpoV);
        t.etapa("validacao");
        if (!parsed.success) return t.aplicar(new Response("Dados inválidos", { status: 400 }));
        return iniciarSessaoWebrtc(t, auth.userId, parsed.data);
      },
    },
  },
});
