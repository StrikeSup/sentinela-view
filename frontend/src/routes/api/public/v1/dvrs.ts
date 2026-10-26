import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/dvrs")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request }) => {
        const { json, exigirUsuario } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        // Client do próprio usuário: só vê os DVRs dos clientes liberados.
        const { data, error } = await r.auth.client
          .from("dvrs")
          .select("id, nome, canais, online, ativo, cliente_id")
          .eq("ativo", true)
          .order("nome");
        if (error) return json({ erro: "Falha ao listar DVRs" }, 500);
        return json({ dvrs: data ?? [] });
      },
    },
  },
});
