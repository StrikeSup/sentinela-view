import { createFileRoute } from "@tanstack/react-router";

// Câmeras do DVR no formato D-Guard (id = índice 0..N por canal).
export const Route = createFileRoute("/api/servers/$guid/cameras")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/gear-api.server")).opcoesGear(),
      GET: async ({ request, params }) => {
        const { usuarioGear, jsonGear } = await import("@/lib/gear-api.server");
        const { dvrPorGuid, camerasOrdenadas } = await import("@/lib/dguard.server");
        const r = await usuarioGear(request);
        if (r.erro) return r.erro;
        const dvr = await dvrPorGuid(r.auth.client, params.guid);
        if (!dvr) return jsonGear({ error: "Server not found" }, 404);
        const { cameras, error } = await camerasOrdenadas(r.auth.client, dvr.id);
        if (error) return jsonGear({ error: error.message }, 502);
        return jsonGear({ cameras: cameras.map((c, idx) => ({ id: idx, name: c.nome })) });
      },
    },
  },
});
