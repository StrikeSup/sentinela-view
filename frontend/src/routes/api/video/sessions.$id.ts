import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/video/sessions/$id")({
  server: {
    handlers: {
      /** Estado da sessão. Endereços de vídeo só saem quando o servidor local já publica. */
      GET: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVisualizar, enderecosDeLeitura } = await import(
          "@/lib/media.server"
        );
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("video_sessions")
          .select("id, estado, path, diagnostico, whep_url, hls_url, expires_at")
          .eq("id", params.id)
          .maybeSingle();
        if (!data) return new Response("Sessão não encontrada", { status: 404 });

        const expirada = new Date(data.expires_at).getTime() < Date.now();
        const estado = expirada && data.estado !== "encerrada" ? "encerrada" : data.estado;

        const publicando = estado === "publicando";
        const enderecos = publicando
          ? enderecosDeLeitura({
              sessionId: data.id,
              path: data.path,
              whep: data.whep_url,
              hls: data.hls_url,
              expiraEm: data.expires_at,
            })
          : { whep_url: null, hls_url: null };

        return Response.json({
          session_id: data.id,
          estado,
          diagnostico: data.diagnostico ?? null,
          whep_url: enderecos.whep_url,
          hls_url: enderecos.hls_url,
          expires_at: data.expires_at,
        });
      },

      DELETE: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId))) return new Response("Sem permissão", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("video_sessions")
          .select("id, espectadores")
          .eq("id", params.id)
          .eq("modo", "publicacao")
          .maybeSingle();
        if (!data) return new Response(null, { status: 204 });

        const restantes = Math.max((data.espectadores ?? 1) - 1, 0);
        if (restantes > 0) {
          await supabaseAdmin
            .from("video_sessions")
            .update({ espectadores: restantes })
            .eq("id", data.id);
        } else {
          await supabaseAdmin
            .from("video_sessions")
            .update({
              espectadores: 0,
              estado: "encerrada",
              expires_at: new Date().toISOString(),
            })
            .eq("id", data.id);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
