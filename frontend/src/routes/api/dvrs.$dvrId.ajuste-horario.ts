import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Operador pede ajuste de horário de um DVR. O Agent busca o pedido no heartbeat.
export const Route = createFileRoute("/api/dvrs/$dvrId/ajuste-horario")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { validarPedidoAjuste } = await import("@/lib/ajuste-horario");
        const { usuarioDaRequisicao } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return Response.json({ erro: "Faça login." }, { status: 401 });
        if (!z.string().uuid().safeParse(params.dvrId).success)
          return Response.json({ erro: "DVR inválido" }, { status: 400 });
        const v = validarPedidoAjuste(await request.json().catch(() => ({})));
        if ("erro" in v) return Response.json({ erro: v.erro }, { status: 400 });

        const { data: pode } = await auth.client.rpc("has_permission" as never, {
          _user_id: auth.userId,
          _perm: "dvrs.editar",
        } as never);
        if (!pode) return Response.json({ erro: "Sem permissão para editar DVRs" }, { status: 403 });
        // Client do usuário: confirma que ele enxerga este DVR (respeita clientes liberados).
        const { data: dvr } = await auth.client.from("dvrs").select("id").eq("id", params.dvrId).maybeSingle();
        if (!dvr) return Response.json({ erro: "DVR não encontrado" }, { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as { from: (t: string) => any };
        await db.from("dvrs").update({ fuso_horario: v.fuso_horario }).eq("id", params.dvrId);
        const { data, error } = await db
          .from("dvr_ajustes_horario")
          .insert({
            dvr_id: params.dvrId,
            fuso_horario: v.fuso_horario,
            modo: v.modo,
            horario_manual: v.horario_manual,
            solicitado_por: auth.userId,
          })
          .select("id, estado")
          .single();
        if (error) return Response.json({ erro: "Falha ao criar pedido" }, { status: 500 });
        return Response.json(data);
      },
    },
  },
});
