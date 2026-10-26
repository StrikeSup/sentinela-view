import { createFileRoute } from "@tanstack/react-router";

// Qualquer tamanho pedido pelo app (ex.: image-320x240.jpg, image-1920x1080.jpg).
export const Route = createFileRoute("/api/servers/$guid/cameras/$camId/streams/$stream/image-{$tam}.jpg")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/gear-api.server")).opcoesGear(),
      GET: async ({ request, params }) => {
        const m = /^(\d{2,4})x(\d{2,4})$/.exec(params.tam);
        const w = m ? Number(m[1]) : 640;
        const h = m ? Number(m[2]) : 480;
        return (await import("@/lib/dguard.server")).imagemGear(request, params.guid, params.camId, w, h, params.stream);
      },
    },
  },
});
