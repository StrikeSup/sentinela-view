import { createFileRoute } from "@tanstack/react-router";

/**
 * Limpeza dos arquivos temporários de reprodução.
 * Deve ser chamada a cada 5 minutos com o cabeçalho x-cron-secret.
 */
export const Route = createFileRoute("/api/public/limpeza-gravacoes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["LOVABLE_CRON_SECRET"];
        const enviado =
          request.headers.get("x-cron-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!segredo || enviado !== segredo) return new Response("Não autorizado", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { apagarExport } = await import("@/lib/exports.server");
        const agora = new Date().toISOString();

        // 1) Reservas expiradas somem.
        await supabaseAdmin.from("recording_playback_leases").delete().lt("expires_at", agora);

        const { data: exportacoes } = await supabaseAdmin
          .from("recording_playback_exports")
          .select("id, object_path, state, expires_at, created_at")
          .limit(500);

        let removidas = 0;
        const limiteAntigo = Date.now() - 60 * 60_000;
        for (const e of exportacoes ?? []) {
          const expirou = new Date(e.expires_at).getTime() < Date.now();
          const travada =
            (e.state === "erro" ||
              e.state === "requested" ||
              e.state === "preparando" ||
              e.state === "enviando") &&
            new Date(e.created_at).getTime() < limiteAntigo;
          if (expirou || travada) {
            await apagarExport(e.id, e.object_path);
            removidas += 1;
          }
        }

        return Response.json(
          { ok: true, removidas },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
