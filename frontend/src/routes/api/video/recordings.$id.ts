import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { configIceServidor, corrigirDestinoIce } from "@/lib/ice-sdp";

const controleSchema = z.object({
  acao: z.enum(["reproduzir", "pausar", "buscar", "velocidade"]),
  posicao_segundos: z.number().finite().min(0).max(31_536_000).optional(),
  velocidade: z.number().finite().min(0.25).max(4).optional(),
});

export const Route = createFileRoute("/api/video/recordings/$id")({
  server: {
    handlers: {
      /** Estado da solicitação; a URL de reprodução só sai quando o servidor publica. */
      GET: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVerGravacoes } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("video_sessions")
          .select(
            "id, servidor_id, estado, diagnostico, hls_url, answer_sdp, modo, expires_at, recording_id, solicitado_por, entregue_em, ultimo_sinal_agente",
          )
          .eq("id", params.id)
          .in("modo", ["recording_hls", "recording_webrtc"])
          .maybeSingle();
        if (!data) return new Response("Solicitação não encontrada", { status: 404 });
        if (data.solicitado_por && data.solicitado_por !== auth.userId)
          return new Response("Sem permissão", { status: 403 });

        const expirada = new Date(data.expires_at).getTime() < Date.now();
        const estado = expirada && data.estado !== "encerrada" ? "encerrada" : data.estado;
        const { data: servidor } = await supabaseAdmin
          .from("servidores")
          .select("midia_webrtc, porta_udp_externa, ip" as "midia_webrtc")
          .eq("id", data.servidor_id)
          .maybeSingle();
        const answerSdp = corrigirDestinoIce(data.answer_sdp, configIceServidor(servidor as never));

        return Response.json({
          session_id: data.id,
          recording_id: data.recording_id,
          modo: data.modo,
          estado,
          answer_sdp: estado === "encerrada" ? null : answerSdp,
          diagnostico: data.diagnostico ?? null,
          // No modo HLS o servidor local devolve o endereço de reprodução em
          // vez do answer_sdp: entrega assim que existir, sem esperar SDP.
          playback_url: estado === "encerrada" ? null : (data.hls_url ?? null),
          entregue_em: data.entregue_em ?? null,
          ultimo_sinal_agente: data.ultimo_sinal_agente ?? null,
          expires_at: data.expires_at,
        });
      },

      /** Envia controles ao processo da gravação já aberto no servidor local. */
      PATCH: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVerGravacoes } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão", { status: 403 });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = controleSchema.safeParse(json);
        if (!parsed.success) return new Response("Controle inválido", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("video_sessions")
          .update({
            acao_reproducao: parsed.data.acao,
            ...(parsed.data.posicao_segundos !== undefined
              ? { posicao_segundos: parsed.data.posicao_segundos }
              : {}),
            ...(parsed.data.velocidade !== undefined
              ? { velocidade: parsed.data.velocidade }
              : {}),
            comando_em: new Date().toISOString(),
          })
          .eq("id", params.id)
          .eq("modo", "recording_webrtc")
          .eq("solicitado_por", auth.userId)
          .neq("estado", "encerrada")
          .select("id")
          .maybeSingle();
        if (error) return new Response("Falha ao controlar a reprodução", { status: 500 });
        if (!data) return new Response("Reprodução não encontrada", { status: 404 });
        return new Response(null, { status: 204 });
      },

      /** Fecha apenas esta solicitação; nunca afeta a de outro usuário. */
      DELETE: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVerGravacoes } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("video_sessions")
          .update({ estado: "encerrada", espectadores: 0, expires_at: new Date().toISOString() })
          .eq("id", params.id)
          .in("modo", ["recording_hls", "recording_webrtc"])
          .eq("solicitado_por", auth.userId);
        return new Response(null, { status: 204 });
      },
    },
  },
});
