import { createFileRoute } from "@tanstack/react-router";

// Pacote de atualização (app.asar) que o aplicativo Windows baixa para se
// atualizar sozinho. Pequeno (poucos KB), servido direto do armazenamento.
const ARQUIVO = "app.asar";

export const Route = createFileRoute("/api/public/v1/app-desktop/payload")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from("app-desktop").download(ARQUIVO);
        if (error || !data) return new Response("Payload não encontrado.", { status: 404 });
        return new Response(await data.arrayBuffer(), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(data.size),
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
