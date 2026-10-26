import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/agent-desktop")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async () => {
        const { loadAgentRelease } = await import("@/lib/agent-release.server");
        const release = await loadAgentRelease();
        if (!release) {
          return Response.json({ error: "Nenhuma versão do Agent publicada." }, { status: 404 });
        }
        return Response.json(
          {
            version: release.version,
            size: release.size,
            sha256: release.sha256,
            runtimeBundled: release.runtimeBundled === true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
