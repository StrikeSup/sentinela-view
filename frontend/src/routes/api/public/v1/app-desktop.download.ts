import { createFileRoute } from "@tanstack/react-router";

// Instalador completo do aplicativo Windows. O armazenamento limita cada
// arquivo, então o instalador é guardado em partes e esta rota entrega tudo
// junto, em sequência, como um único .zip (o usuário vê um download normal).
const PREFIXO = "Sentinela-VIEW-Windows.zip.parte";

export const Route = createFileRoute("/api/public/v1/app-desktop/download")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: info } = await (supabaseAdmin as any)
          .from("app_desktop")
          .select("instalador_tamanho, instalador_partes")
          .limit(1)
          .maybeSingle();
        if (!info) return new Response("Nenhuma versão publicada.", { status: 404 });

        const partes = Number(info.instalador_partes) || 1;
        let proxima = 1;
        const stream = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (proxima > partes) {
                controller.close();
                return;
              }
              const indice = proxima++;
              const { data, error } = await supabaseAdmin.storage
                .from("app-desktop")
                .download(`${PREFIXO}${indice}`);
              if (error || !data) {
                controller.close();
                return;
              }
              controller.enqueue(new Uint8Array(await data.arrayBuffer()));
            },
          },
          { highWaterMark: 1 },
        );

        return new Response(stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Length": String(Number(info.instalador_tamanho)),
            "Content-Disposition": 'attachment; filename="Sentinela-VIEW-Windows.zip"',
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
