import { createFileRoute } from "@tanstack/react-router";

const DURACAO_SEGUNDOS = 45;

export const Route = createFileRoute("/api/video/sessions/$id/keepalive")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
          const auth = await usuarioDaRequisicao(request);
          if (!auth) return new Response("Não autorizado", { status: 401 });
          if (!(await podeVisualizar(auth.userId))) return new Response("Sem permissão", { status: 403 });

          const expira = new Date(Date.now() + DURACAO_SEGUNDOS * 1000).toISOString();
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Quedas momentâneas de rede com o banco não podem derrubar a tela:
          // tenta de novo e, se ainda falhar, responde "adiado" (200) para o
          // navegador simplesmente renovar no próximo ciclo.
          let ultimoErro = "";
          for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0) await new Promise((r) => setTimeout(r, 300 * tentativa));
            const { data, error } = await supabaseAdmin
              .from("video_sessions")
              .update({ expires_at: expira })
              .eq("id", params.id)
              .neq("estado", "encerrada")
              .select("id, estado")
              .maybeSingle();

            if (!error) {
              if (!data) return new Response("Sessão não encontrada", { status: 404 });
              return Response.json({ session_id: data.id, estado: data.estado, expires_at: expira });
            }
            ultimoErro = error.message;
          }

          console.warn("[keepalive] renovação adiada", params.id, ultimoErro);
          return Response.json({ renovado: false, motivo: "indisponivel_temporariamente" });
        } catch (e) {
          console.warn("[keepalive] renovação adiada (erro inesperado)", params.id, e);
          return Response.json({ renovado: false, motivo: "indisponivel_temporariamente" });
        }
      },
    },
  },
});
