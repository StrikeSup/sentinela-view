import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  dvr_id: z.string().uuid(),
  canal: z.number().int().min(1).max(256),
  /** "direto" = aplicativo Windows: o Agent publica sem conversão (H.264/H.265). */
  entrega: z.enum(["padrao", "direto"]).optional(),
  qualidade: z.enum(["extra", "principal"]).optional(),
});

const DURACAO_INICIAL_SEGUNDOS = 120; // validade inicial enquanto o servidor local sobe a publicação
const DURACAO_RENOVACAO_SEGUNDOS = 45;

export const Route = createFileRoute("/api/video/sessions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { usuarioDaRequisicao, podeVisualizar, novoPath } = await import("@/lib/media.server");

        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão para visualizar câmeras", { status: 403 });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) return new Response("Dados inválidos", { status: 400 });

        // Sem destino público de mídia a sessão de publicação falharia na hora.
        // Não criamos a linha: era isso que gerava centenas de sessões por câmera.
        const { configMidiaInfra } = await import("@/lib/media.server");
        if (!configMidiaInfra())
          return Response.json(
            { erro: "Caminho reserva de vídeo não configurado.", retry_after_ms: 30_000 },
            { status: 503, headers: { "Retry-After": "30" } },
          );

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: dvr } = await supabaseAdmin
          .from("dvrs")
          .select("id, servidor_id, ativo")
          .eq("id", parsed.data.dvr_id)
          .maybeSingle();
        if (!dvr || !dvr.ativo || !dvr.servidor_id)
          return Response.json(
            { erro: "DVR indisponível ou sem servidor vinculado." },
            { status: 400 },
          );

        const agora = new Date();
        const entrega = parsed.data.entrega ?? "padrao";
        const qualidade = parsed.data.qualidade ?? "extra";

        const { data: existente } = await supabaseAdmin
          .from("video_sessions")
          .select("id, estado, espectadores")
          .eq("dvr_id", dvr.id)
          .eq("canal", parsed.data.canal)
          // sessões WebRTC são individuais por espectador e nunca reaproveitadas aqui
          .eq("modo", "publicacao")
          .eq("entrega", entrega)
          .eq("qualidade", qualidade)
          .in("estado", ["solicitada", "conectando", "publicando"])
          .gt("expires_at", agora.toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existente) {
          await supabaseAdmin
            .from("video_sessions")
            .update({
              espectadores: (existente.espectadores ?? 0) + 1,
              expires_at: new Date(
                agora.getTime() + DURACAO_RENOVACAO_SEGUNDOS * 1000,
              ).toISOString(),
            })
            .eq("id", existente.id);
          return Response.json({ session_id: existente.id, estado: existente.estado });
        }

        const { data: criada, error } = await supabaseAdmin
          .from("video_sessions")
          .insert({
            servidor_id: dvr.servidor_id,
            dvr_id: dvr.id,
            canal: parsed.data.canal,
            solicitado_por: auth.userId,
            path: novoPath(),
            entrega,
            qualidade,
            estado: "solicitada",
            espectadores: 1,
            expires_at: new Date(
              agora.getTime() + DURACAO_INICIAL_SEGUNDOS * 1000,
            ).toISOString(),
          })
          .select("id, estado")
          .single();
        if (error || !criada) return new Response("Falha ao criar sessão", { status: 500 });

        return Response.json({ session_id: criada.id, estado: criada.estado });
      },
    },
  },
});
