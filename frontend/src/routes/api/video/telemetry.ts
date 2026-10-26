import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Telemetria sanitizada do player: apenas tempos, rota e contadores.
// Nunca recebe SDP completo, IP, credencial ou URL RTSP.
const schema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  correlation_id: z.string().uuid().nullable().optional(),
  dvr_id: z.string().uuid().nullable().optional(),
  canal: z.number().int().min(1).max(512).nullable().optional(),
  qualidade: z.enum(["extra", "principal"]).optional(),
  rota: z.enum(["TURN", "LAN", "P2P", "DIRECT_UNKNOWN", "UNKNOWN"]).optional(),
  tipo_candidato_local: z.string().max(40).nullable().optional(),
  tipo_candidato_remoto: z.string().max(40).nullable().optional(),
  // Tempos T0–T8 + tentativa_id + etapas do "Caminho da imagem" (sanitizados).
  tempos: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 8_000, "tempos grande demais")
    .optional(),
  tentativa_id: z.string().max(64).nullable().optional(),
  bytes_recebidos: z.number().int().min(0).optional(),
  quadros_decodificados: z.number().int().min(0).optional(),
  pacotes_recebidos: z.number().int().min(0).optional(),
  connection_state: z.string().max(40).nullable().optional(),
  ice_connection_state: z.string().max(40).nullable().optional(),
  signaling_state: z.string().max(40).nullable().optional(),
  ultimo_quadro_em: z.string().datetime().nullable().optional(),
  motivo_reconexao: z.string().max(500).nullable().optional(),
  pedidos_ativos: z.number().int().min(0).optional(),
  conexoes_ativas: z.number().int().min(0).optional(),
  congelamentos: z.number().int().min(0).optional(),
  erro: z.string().max(500).nullable().optional(),
});

export const Route = createFileRoute("/api/video/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { usuarioDaRequisicao } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) return new Response("Dados inválidos", { status: 400 });
        const d = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("video_telemetria").insert({
          session_id: d.session_id ?? null,
          correlation_id: d.correlation_id ?? null,
          usuario_id: auth.userId,
          dvr_id: d.dvr_id ?? null,
          canal: d.canal ?? null,
          qualidade: d.qualidade ?? null,
          rota: d.rota ?? null,
          tipo_candidato_local: d.tipo_candidato_local ?? null,
          tipo_candidato_remoto: d.tipo_candidato_remoto ?? null,
          tempos: (d.tempos ?? null) as import("@/integrations/supabase/types").Json | null,
          bytes_recebidos: d.bytes_recebidos ?? null,
          quadros_decodificados: d.quadros_decodificados ?? null,
          pacotes_recebidos: d.pacotes_recebidos ?? null,
          connection_state: d.connection_state ?? null,
          ice_connection_state: d.ice_connection_state ?? null,
          signaling_state: d.signaling_state ?? null,
          ultimo_quadro_em: d.ultimo_quadro_em ?? null,
          motivo_reconexao: d.motivo_reconexao ?? null,
          pedidos_ativos: d.pedidos_ativos ?? null,
          conexoes_ativas: d.conexoes_ativas ?? null,
          congelamentos: d.congelamentos ?? null,
          erro: d.erro ?? null,
        });
        if (error) {
          console.error("[telemetria] falha ao registrar", error.message);
          return new Response(null, { status: 202 });
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
