import { createFileRoute } from "@tanstack/react-router";

// Lista de DVRs do usuário no formato D-Guard (guid = {UUID}).
export const Route = createFileRoute("/api/servers")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/gear-api.server")).opcoesGear(),
      GET: async ({ request }) => {
        const { usuarioGear, jsonGear } = await import("@/lib/gear-api.server");
        const { guidDeUuid } = await import("@/lib/dguard.server");
        const r = await usuarioGear(request);
        if (r.erro) return r.erro;
        const { data, error } = await r.auth.client
          .from("dvrs")
          .select("id, nome, online, ativo")
          .eq("ativo", true)
          .order("nome");
        if (error) return jsonGear({ error: error.message }, 502);
        return jsonGear({
          servers: (data ?? []).map((d) => ({
            name: d.nome,
            guid: guidDeUuid(d.id),
            parentGuid: null,
            hasChildren: false,
            active: d.ativo,
            connected: d.online,
          })),
        });
      },
    },
  },
});
