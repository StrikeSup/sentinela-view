import { createFileRoute } from "@tanstack/react-router";

/**
 * Última foto conhecida de uma câmera, mostrada enquanto o vídeo ao vivo carrega.
 * Nunca espera: sem foto guardada, registra o pedido ao Agent e responde 204.
 */
export const Route = createFileRoute("/api/video/previa")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão", { status: 403 });

        const url = new URL(request.url);
        const dvrId = url.searchParams.get("dvr_id") ?? "";
        const canal = Number(url.searchParams.get("canal") ?? "0");
        if (!/^[0-9a-f-]{36}$/i.test(dvrId) || !Number.isInteger(canal) || canal < 1)
          return new Response("Dados inválidos", { status: 400 });

        const { lerSnapshot, solicitarSnapshot } = await import("@/lib/snapshot-cache.server");
        const foto = lerSnapshot(dvrId, canal, 5 * 60_000, 1);
        if (!foto) {
          solicitarSnapshot(dvrId, canal);
          return new Response(null, { status: 204 });
        }
        return new Response(foto, {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
        });
      },
    },
  },
});
