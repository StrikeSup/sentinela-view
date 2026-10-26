import { createFileRoute } from "@tanstack/react-router";

// Manifesto público da versão atual do aplicativo Windows. O próprio aplicativo
// confere este endereço periodicamente e se atualiza sozinho quando a versão
// daqui for maior que a dele. Expõe apenas versão e assinaturas dos arquivos.
export const Route = createFileRoute("/api/public/v1/app-desktop")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await (supabaseAdmin as any)
          .from("app_desktop")
          .select(
            "versao, payload_sha256, payload_tamanho, instalador_sha256, instalador_tamanho, instalador_partes, atualizado_em",
          )
          .limit(1)
          .maybeSingle();
        if (!data) return Response.json({ erro: "Nenhuma versão publicada." }, { status: 404 });
        return Response.json(
          {
            versao: data.versao,
            payload: { sha256: data.payload_sha256, tamanho: Number(data.payload_tamanho) },
            instalador: {
              nome: "Sentinela-VIEW-Windows.zip",
              sha256: data.instalador_sha256,
              tamanho: Number(data.instalador_tamanho),
              partes: data.instalador_partes,
            },
            atualizado_em: data.atualizado_em,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
