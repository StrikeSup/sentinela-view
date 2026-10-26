import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/agent-desktop/download")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async () => {
        const { AGENT_RELEASE_BUCKET, loadAgentRelease } = await import("@/lib/agent-release.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const release = await loadAgentRelease();
        if (!release) return new Response("Instalador indisponível.", { status: 404 });

        // Falhar antes dos headers se alguma parte foi removida ou truncada.
        for (const part of release.parts) {
          const { data, error } = await supabaseAdmin.storage.from(AGENT_RELEASE_BUCKET).info(part.path);
          if (error || !data || Number(data.size) !== part.size) {
            return new Response("Instalador incompleto.", { status: 503 });
          }
        }

        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (index >= release.parts.length) {
              controller.close();
              return;
            }
            const part = release.parts[index++];
            if (!part) {
              controller.error(new Error("Parte do instalador inválida."));
              return;
            }
            const { data, error } = await supabaseAdmin.storage.from(AGENT_RELEASE_BUCKET).download(part.path);
            if (error || !data || data.size !== part.size) {
              controller.error(new Error("Parte do instalador indisponível."));
              return;
            }
            const bytes = new Uint8Array(await data.arrayBuffer());
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const actualHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
            if (actualHash !== part.sha256) {
              controller.error(new Error("Parte do instalador corrompida."));
              return;
            }
            controller.enqueue(bytes);
          },
        }, { highWaterMark: 1 });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(release.size),
            "Content-Disposition": `attachment; filename="${release.fileName}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
