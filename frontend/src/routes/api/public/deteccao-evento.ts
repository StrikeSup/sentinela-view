import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// O servidor local (Agent) avisa aqui quando uma câmera teve movimento,
// quando o portão abriu/fechou e qual o estado atual do portão (para o selo da tela Detecção).
// POST { licenca, eventos: [{ dvr_id, canal, detalhe?, tipo?, estado? }] } com header x-agente-token.
// tipo "portao_estado" não cria evento: só atualiza cameras_portao.estado/estado_em.
const schema = z.object({
  licenca: z.string().min(4).max(200),
  eventos: z
    .array(
      z.object({
        dvr_id: z.string().uuid(),
        canal: z.number().int().min(0).max(1024),
        detalhe: z.string().max(300).optional(),
        ocorrido_em: z.string().max(60).optional(),
        tipo: z.enum(["movimento", "portao_aberto", "portao_fechado", "portao_estado"]).optional(),
        estado: z.enum(["aberto", "fechado"]).optional(),
        aberto_desde: z.string().max(60).optional(),
        // foto do momento do evento (data URL JPEG ou base64 puro), até ~600 KB
        snapshot: z.string().max(800_000).optional(),
      }),
    )
    .min(1)
    .max(200),
});

function token(request: Request) {
  return (
    request.headers.get("x-agente-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

export const Route = createFileRoute("/api/public/deteccao-evento")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const chave = token(request);
        if (!chave) return new Response("Chave obrigatória", { status: 400 });

        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return new Response("Corpo inválido", { status: 400 });
        }
        const p = schema.safeParse(corpo);
        if (!p.success) return new Response("Dados inválidos", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: servidor } = await supabaseAdmin
          .from("servidores")
          .select("id, cliente_id")
          .eq("licenca", p.data.licenca)
          .eq("token", chave)
          .eq("ativo", true)
          .maybeSingle();
        if (!servidor) return new Response("Licença ou chave inválida", { status: 401 });

        const { data: dvrs } = await supabaseAdmin
          .from("dvrs")
          .select("id, cliente_id")
          .eq("servidor_id", servidor.id);
        const permitidos = new Map((dvrs ?? []).map((d) => [d.id, d.cliente_id]));

        // Só aceita câmeras que foram explicitamente ativadas e salvas na tela de Detecção.
        // Câmera sem configuração = detecção desligada (padrão).
        const idsDvrs = [...new Set(p.data.eventos.map((e) => e.dvr_id))].filter((id) =>
          permitidos.has(id),
        );
        const ativas = new Set<string>();
        const portoes = new Set<string>();
        if (idsDvrs.length) {
          const [{ data: configs }, { data: cfgPortao }] = await Promise.all([
            supabaseAdmin
              .from("cameras_deteccao" as never)
              .select("dvr_id, canal, ativo")
              .in("dvr_id", idsDvrs)
              .eq("ativo", true),
            supabaseAdmin
              .from("cameras_portao" as never)
              .select("dvr_id, canal, ativo")
              .in("dvr_id", idsDvrs)
              .eq("ativo", true),
          ]);
          for (const c of (configs ?? []) as unknown as { dvr_id: string; canal: number }[]) {
            ativas.add(`${c.dvr_id}:${c.canal}`);
          }
          for (const c of (cfgPortao ?? []) as unknown as { dvr_id: string; canal: number }[]) {
            portoes.add(`${c.dvr_id}:${c.canal}`);
          }
        }
        const foto = (s?: string) => {
          if (!s) return null;
          const t = s.trim();
          if (t.startsWith("data:image/jpeg;base64,")) return t;
          if (/^[A-Za-z0-9+/=\s]+$/.test(t) && t.startsWith("/9j/")) return `data:image/jpeg;base64,${t.replace(/\s/g, "")}`;
          return null;
        };

        const validos = p.data.eventos.filter((e) => {
          if (!permitidos.has(e.dvr_id)) return false;
          const k = `${e.dvr_id}:${e.canal}`;
          return e.tipo && e.tipo !== "movimento" ? portoes.has(k) : ativas.has(k);
        });

        // Avisos de estado do portão: atualizam cameras_portao, sem criar evento.
        const agora = new Date().toISOString();
        const estados = new Map<string, { dvr_id: string; canal: number; estado: string }>();
        for (const e of validos) {
          if (e.tipo !== "portao_estado" || !e.estado) continue;
          estados.set(`${e.dvr_id}:${e.canal}`, { dvr_id: e.dvr_id, canal: e.canal, estado: e.estado });
        }
        for (const a of estados.values()) {
          await supabaseAdmin
            .from("cameras_portao" as never)
            .update({ estado: a.estado, estado_em: agora } as never)
            .eq("dvr_id", a.dvr_id)
            .eq("canal", a.canal);
        }

        const linhas = validos
          .filter((e) => e.tipo !== "portao_estado")
          .map((e) => ({
            tipo: e.tipo ?? "movimento",
            snapshot: e.tipo === "portao_aberto" ? foto(e.snapshot) : null,
            cliente_id: permitidos.get(e.dvr_id) ?? servidor.cliente_id,
            servidor_id: servidor.id,
            dvr_id: e.dvr_id,
            canal: e.canal,
            origem: "agent",
            detalhe:
              e.detalhe ?? (e.aberto_desde ? `Aberto desde ${e.aberto_desde}` : null),
            ocorrido_em: e.ocorrido_em ?? new Date().toISOString(),
          }));

        if (!linhas.length) return Response.json({ gravados: 0, estados: estados.size });

        const { error } = await supabaseAdmin
          .from("eventos_deteccao" as never)
          .insert(linhas as never);
        if (error) return new Response(error.message, { status: 500 });

        return Response.json({ gravados: linhas.length, estados: estados.size });
      },
    },
  },
});
