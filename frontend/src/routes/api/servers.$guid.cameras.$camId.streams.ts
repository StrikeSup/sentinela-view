import { createFileRoute } from "@tanstack/react-router";

// Streams da câmera (0 = principal, 1 = extra) no formato D-Guard.
export const Route = createFileRoute("/api/servers/$guid/cameras/$camId/streams")({
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
        const { cameras } = await camerasOrdenadas(r.auth.client, dvr.id);
        const idx = Number(params.camId);
        if (!Number.isInteger(idx) || !cameras[idx]) return jsonGear({ error: "Camera not found" }, 404);
        return jsonGear({
          streams: [
            { id: 0, enabled: true, allowsEnableUpdate: true },
            { id: 1, enabled: true, allowsEnableUpdate: true },
          ],
        });
      },
    },
  },
});
