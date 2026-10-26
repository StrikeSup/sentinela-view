import { createFileRoute } from "@tanstack/react-router";
import { cronometro } from "@/lib/server-timing";

// Mesmo fluxo do Diagnóstico WebRTC/Visualização: o navegador da empresa envia
// a oferta SDP, o Agent responde e o vídeo vai direto do Agent ao navegador.
export const Route = createFileRoute("/api/public/v1/webrtc")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      POST: async ({ request }) => {
        const t = cronometro();
        const { exigirUsuario, json, comCors } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        t.etapa("permissao");
        if (r.erro) return r.erro;

        let corpo: unknown = null;
        try {
          corpo = await request.json();
        } catch {
          return json({ erro: "JSON inválido" }, 400);
        }
        const { corpoOfertaSchema, iniciarSessaoWebrtc } =
          await import("@/lib/webrtc-sinalizacao.server");
        const p = corpoOfertaSchema.safeParse(corpo);
        t.etapa("validacao");
        if (!p.success) return json({ erro: "Informe dvr_id, canal (1-512) e offer_sdp." }, 400);

        // O DVR precisa estar entre os que ESTE usuário pode ver (clientes permitidos).
        const { data: permitido } = await r.auth.client
          .from("dvrs")
          .select("id")
          .eq("id", p.data.dvr_id)
          .maybeSingle();
        t.etapa("acesso_dvr");
        if (!permitido) return json({ erro: "DVR não encontrado." }, 404);

        // Sem identificador do player, cada chamada vira uma sessão própria: vários
        // espectadores com o mesmo usuário da API não derrubam uns aos outros.
        const dados = {
          ...p.data,
          cliente_sessao: p.data.cliente_sessao ?? `api:${crypto.randomUUID()}`,
        };
        return comCors(await iniciarSessaoWebrtc(t, r.auth.userId, dados));
      },
    },
  },
});
