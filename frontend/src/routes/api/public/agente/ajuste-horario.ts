import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Agent v45 devolve o resultado do ajuste de horário. Idempotente.
const corpo = z.object({
  id: z.string().uuid(),
  dvr_id: z.string().uuid(),
  estado: z.enum(["concluido", "falhou"]),
  horario_anterior: z.string().max(64).nullish(),
  horario_aplicado: z.string().max(64).nullish(),
  horario_confirmado: z.string().max(64).nullish(),
  fuso_horario: z.string().max(64).nullish(),
  modo: z.enum(["ntp", "manual"]).nullish(),
  servidores_ntp: z.string().max(300).nullish(),
  erro: z.string().max(500).nullish(),
  concluido_em: z.string().max(40).nullish(),
});

export const Route = createFileRoute("/api/public/agente/ajuste-horario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const licenca = new URL(request.url).searchParams.get("licenca") ?? "";
        const chave =
          request.headers.get("x-agente-token") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!licenca || !chave) return new Response("Licença e chave obrigatórias", { status: 400 });
        const p = corpo.safeParse(await request.json().catch(() => null));
        if (!p.success) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
        const r = p.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: servidor } = await supabaseAdmin
          .from("servidores")
          .select("id")
          .eq("licenca", licenca)
          .eq("token", chave)
          .eq("ativo", true)
          .maybeSingle();
        if (!servidor) return new Response("Licença ou chave inválida", { status: 401 });

        const db = supabaseAdmin as unknown as { from: (t: string) => any };
        const { data: pedido } = await db
          .from("dvr_ajustes_horario")
          .select("id, dvr_id, estado, modo, fuso_horario, dvrs!inner(servidor_id)")
          .eq("id", r.id)
          .eq("dvr_id", r.dvr_id)
          .maybeSingle();
        if (!pedido || pedido.dvrs?.servidor_id !== servidor.id)
          return Response.json({ erro: "Pedido não pertence a esta licença" }, { status: 404 });
        // Repetição do resultado já gravado: confirma sem alterar.
        if (pedido.estado === "concluido" || pedido.estado === "falhou")
          return Response.json({ ok: true, estado: pedido.estado, repetido: true });
        const { resultadoConfere } = await import("@/lib/ajuste-horario");
        if (!resultadoConfere(pedido, r))
          return Response.json({ erro: "Modo ou fuso diferente do pedido" }, { status: 409 });

        const concl = r.concluido_em && !isNaN(Date.parse(r.concluido_em)) ? r.concluido_em : new Date().toISOString();
        const { error } = await db
          .from("dvr_ajustes_horario")
          .update({
            estado: r.estado,
            horario_anterior: r.horario_anterior ?? null,
            horario_aplicado: r.horario_aplicado ?? null,
            horario_confirmado: r.horario_confirmado ?? null,
            servidores_ntp: pedido.modo === "manual" ? null : (r.servidores_ntp ?? null),
            erro: r.estado === "falhou" ? (r.erro ?? "Falha sem detalhe") : null,
            concluido_em: concl,
          })
          .eq("id", r.id);
        if (error) return Response.json({ erro: "Falha ao gravar" }, { status: 500 });
        if (r.estado === "concluido" && r.horario_confirmado)
          await db
            .from("dvrs")
            .update({ data_hora_dvr: r.horario_confirmado, dados_dvr_atualizados_em: new Date().toISOString() })
            .eq("id", r.dvr_id);
        return Response.json({ ok: true, estado: r.estado });
      },
    },
  },
});
