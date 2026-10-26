import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const pedidoSchema = z.object({
  janela_id: z.string().uuid(),
  cameras: z
    .array(z.object({ dvr_id: z.string().uuid(), canal: z.number().int().min(1).max(512) }))
    .max(64),
});

export const Route = createFileRoute("/api/public/v1/preparar-layout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { exigirUsuario, json } = await import("@/lib/api-publica.server");
        const acesso = await exigirUsuario(request);
        if (acesso.erro) return acesso.erro;
        const dados = pedidoSchema.safeParse(await request.json().catch(() => null));
        if (!dados.success) return json({ erro: "Lista de câmeras inválida." }, 400);
        const cameras = [
          ...new Map(dados.data.cameras.map((c) => [`${c.dvr_id}:${c.canal}`, c])).values(),
        ];
        if (!cameras.length) return json({ ok: true, preparadas: 0 });
        const ids = [...new Set(cameras.map((c) => c.dvr_id))];
        const { data: permitidos, error: erroAcesso } = await acesso.auth.client
          .from("dvrs")
          .select("id")
          .in("id", ids);
        if (erroAcesso || permitidos?.length !== ids.length)
          return json({ erro: "DVR não autorizado." }, 403);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const expira_em = new Date(Date.now() + 45_000).toISOString();
        const { error } = await supabaseAdmin.from("preparo_layout" as never).upsert(
          cameras.map((c) => ({
            usuario_id: acesso.auth.userId,
            janela_id: dados.data.janela_id,
            dvr_id: c.dvr_id,
            canal: c.canal,
            expira_em,
          })) as never,
          { onConflict: "usuario_id,janela_id,dvr_id,canal" },
        );
        if (error) return json({ erro: "Preparação temporariamente indisponível." }, 503);
        // A renovação de qualquer janela limpa intenções abandonadas após o prazo.
        await supabaseAdmin
          .from("preparo_layout" as never)
          .delete()
          .lt("expira_em", new Date(Date.now() - 60_000).toISOString());
        return json({ ok: true, preparadas: cameras.length, expira_em });
      },
    },
  },
});
