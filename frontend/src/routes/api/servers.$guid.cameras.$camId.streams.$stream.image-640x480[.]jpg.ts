import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/servers/$guid/cameras/$camId/streams/$stream/image-640x480.jpg")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/gear-api.server")).opcoesGear(),
      GET: async ({ request, params }) =>
        (await import("@/lib/dguard.server")).imagemGear(request, params.guid, params.camId, 640, 480, params.stream),
    },
  },
});
