import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Agent envia o JPEG nativo do DVR (bytes puros) pela conexão de saída.
// Headers: x-agente-token, x-dvr-id, x-canal, Content-Type: image/jpeg.
const MAX_BYTES = 3 * 1024 * 1024;

export const Route = createFileRoute("/api/public/agente/snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const h = request.headers;
        const chave = h.get("x-agente-token") ?? h.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const dvr = z.string().uuid().safeParse(h.get("x-dvr-id"));
        const canal = z.coerce.number().int().min(1).max(512).safeParse(h.get("x-canal"));
        // x-stream opcional: 0/main = principal, 1/extra/sub = secundário.
        const xs = (h.get("x-stream") ?? "").trim().toLowerCase();
        const stream = xs === "" ? undefined : ["1", "extra", "sub", "secundario"].includes(xs) ? 1 : 0;
        if (!chave) return new Response("Chave obrigatória", { status: 401 });
        if (!dvr.success || !canal.success)
          return new Response("x-dvr-id ou x-canal inválido", { status: 400 });
        if (!(h.get("content-type") ?? "").includes("image/jpeg"))
          return new Response("Content-Type deve ser image/jpeg", { status: 415 });

        const bytes = await request.arrayBuffer();
        if (bytes.byteLength < 100 || bytes.byteLength > MAX_BYTES)
          return new Response("JPEG inválido", { status: 400 });
        const ini = new Uint8Array(bytes, 0, 2);
        if (ini[0] !== 0xff || ini[1] !== 0xd8) return new Response("JPEG inválido", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: servidor } = await supabaseAdmin
          .from("servidores")
          .select("id")
          .eq("token", chave)
          .eq("ativo", true)
          .maybeSingle();
        if (!servidor) return new Response("Chave inválida", { status: 401 });

        const { data: d } = await supabaseAdmin
          .from("dvrs")
          .select("id")
          .eq("id", dvr.data)
          .eq("servidor_id", servidor.id)
          .maybeSingle();
        if (!d) return new Response("DVR não pertence a este servidor", { status: 403 });

        const { guardarSnapshot } = await import("@/lib/snapshot-cache.server");
        guardarSnapshot(dvr.data, canal.data, bytes, stream);
        return Response.json({ ok: true });
      },
    },
  },
});
