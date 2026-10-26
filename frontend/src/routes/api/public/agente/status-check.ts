import { createFileRoute } from "@tanstack/react-router";

// Rotina periódica: marca como offline os servidores que ficaram sem sinal
// além do tempo configurado (padrão 10 minutos) e registra os eventos.
// Chamar com o header x-cron-secret.
export const Route = createFileRoute("/api/public/agente/status-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["LOVABLE_CRON_SECRET"];
        const enviado = request.headers.get("x-cron-secret") ?? "";
        if (!segredo || enviado !== segredo) return new Response("Não autorizado", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // marcar_offline_expirados também executa o failover/retorno dos DVRs
        const { data, error } = await supabaseAdmin.rpc("marcar_offline_expirados");
        if (error) return new Response("Falha ao atualizar status", { status: 500 });
        return Response.json({ ok: true, servidores_offline: data ?? 0 });
      },
    },
  },
});
