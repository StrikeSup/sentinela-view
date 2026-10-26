import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  recording_id: z.string().min(4).max(200),
  // Quando o navegador envia a oferta, a gravação é entregue por WebRTC direto
  // (uma única porta UDP), sem depender do domínio HLS.
  offer_sdp: z.string().min(10).max(100_000).optional(),
});

const DURACAO_SEGUNDOS = 15 * 60;

export const Route = createFileRoute("/api/video/recordings")({
  server: {
    handlers: {
      /** Uma ação do usuário cria exatamente uma solicitação de reprodução. */
      POST: async ({ request }) => {
        const { usuarioDaRequisicao, podeVerGravacoes, novoPath } = await import(
          "@/lib/media.server"
        );
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão para ver gravações", { status: 403 });

        // Reprodução histórica por HLS/WebRTC está desativada: o Agent alpha 63 não
        // implementa esse fluxo. Use POST /api/video/exports (MP4).
        if (process.env["RECORDING_STREAM_ENABLED"] !== "1") {
          return Response.json(
            { erro: "Reprodução por fluxo desativada. Use a exportação MP4 (/api/video/exports)." },
            { status: 410 },
          );
        }
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) return new Response("Dados inválidos", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: arquivo } = await supabaseAdmin
          .from("arquivos_gravados")
          .select("id, servidor_id, dvr_id, canal, disponivel")
          .eq("id", parsed.data.recording_id)
          .maybeSingle();

        if (!arquivo) return Response.json({ erro: "Gravação não encontrada." }, { status: 404 });
        if (!arquivo.disponivel)
          return Response.json({ erro: "Gravação indisponível no servidor." }, { status: 409 });
        if (!arquivo.dvr_id)
          return Response.json({ erro: "Gravação sem DVR vinculado." }, { status: 409 });

        const agora = Date.now();
        const offer = parsed.data.offer_sdp;
        const modo = offer ? "recording_webrtc" : "recording_hls";

        if (offer) {
          // Cada oferta pertence a uma RTCPeerConnection específica: nunca
          // reaproveita sessão. Encerra apenas as anteriores deste usuário
          // para o mesmo arquivo, sem tocar nas de outros espectadores.
          // Também encerra pedidos antigos em HLS: misturar os dois protocolos
          // fazia o servidor local responder com playback_url enquanto o
          // navegador esperava o answer_sdp.
          await supabaseAdmin
            .from("video_sessions")
            .update({ estado: "encerrada", espectadores: 0, expires_at: new Date().toISOString() })
            .in("modo", ["recording_webrtc", "recording_hls"])
            .eq("recording_id", arquivo.id)
            .eq("solicitado_por", auth.userId)
            .neq("estado", "encerrada");
        } else {
          // Reaproveita uma solicitação recente do mesmo usuário para o mesmo
          // arquivo: se o servidor já publicou (ou já está preparando), não faz
          // sentido pedir tudo de novo e esperar o ciclo inteiro outra vez.
          const { data: existentes } = await supabaseAdmin
            .from("video_sessions")
            .select("id, estado, expires_at")
            .eq("modo", "recording_hls")
            .eq("recording_id", arquivo.id)
            .eq("solicitado_por", auth.userId)
            .in("estado", ["publicando", "preparando", "solicitada"])
            .gt("expires_at", new Date(agora + 30_000).toISOString())
            .order("created_at", { ascending: false })
            .limit(5);

          const reutilizavel = (existentes ?? []).find(
            (s) =>
              s.estado === "publicando" || s.estado === "preparando" || s.estado === "solicitada",
          );
          if (reutilizavel) {
            return Response.json({
              session_id: reutilizavel.id,
              estado: reutilizavel.estado,
              modo,
            });
          }
        }

        const { data: criada, error } = await supabaseAdmin
          .from("video_sessions")
          .insert({
            servidor_id: arquivo.servidor_id,
            dvr_id: arquivo.dvr_id,
            canal: arquivo.canal ?? 1,
            solicitado_por: auth.userId,
            modo,
            recording_id: arquivo.id,
            path: novoPath(),
            ...(offer ? { offer_sdp: offer } : {}),
            estado: "solicitada",
            espectadores: 1,
            expires_at: new Date(agora + DURACAO_SEGUNDOS * 1000).toISOString(),
          })
          .select("id, estado, dvr_id, canal, path, expires_at")
          .single();
        if (error || !criada) return new Response("Falha ao criar solicitação", { status: 500 });

        return Response.json({
          session_id: criada.id,
          estado: criada.estado,
          modo,
          dvr_id: criada.dvr_id,
          canal: criada.canal,
          path: criada.path,
          expires_at: criada.expires_at,
        });
      },
    },
  },
});
