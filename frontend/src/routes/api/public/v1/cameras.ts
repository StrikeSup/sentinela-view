import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/v1/cameras")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request }) => {
        const { json, exigirUsuario } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        const dvrId = new URL(request.url).searchParams.get("dvr_id");
        if (!z.string().uuid().safeParse(dvrId).success)
          return json({ erro: "Informe dvr_id válido." }, 400);
        const { data: dvr } = await r.auth.client
          .from("dvrs")
          .select("id")
          .eq("id", dvrId!)
          .maybeSingle();
        if (!dvr) return json({ erro: "DVR não encontrado." }, 404);
        const { data, error } = await r.auth.client
          .from("cameras")
          .select("id, canal, nome, online")
          .eq("dvr_id", dvrId!)
          .order("canal");
        if (error) return json({ erro: "Falha ao listar câmeras" }, 500);
        return json({ cameras: data ?? [] });
      },
    },
  },
});
