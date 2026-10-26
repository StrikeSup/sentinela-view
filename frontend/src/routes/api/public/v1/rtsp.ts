import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Entrega em RTSP o vídeo já pronto (o mesmo que o Agent publica para o
// WebRTC/HLS). O Agent publica na VPS e o VLC lê da VPS com token próprio.
const schema = z.object({
  dvr_id: z.string().uuid(),
  canal: z.coerce.number().int().min(1).max(512),
  minutos: z.coerce.number().int().min(1).max(240).default(60),
  // Segundos esperando a câmera começar a transmitir antes de responder.
  // 0 = responde na hora (202) e o VLC conecta assim que a imagem subir.
  aguardar: z.coerce.number().int().min(0).max(30).default(20),
});

export const Route = createFileRoute("/api/public/v1/rtsp")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request }) => {
        const { json, exigirUsuario } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        const q = new URL(request.url).searchParams;
        const p = schema.safeParse({
          dvr_id: q.get("dvr_id"),
          canal: q.get("canal"),
          minutos: q.get("minutos") ?? undefined,
          aguardar: q.get("aguardar") ?? undefined,
        });
        if (!p.success)
          return json({ erro: "Informe dvr_id e canal (minutos: 1–240, aguardar: 0–30)." }, 400);

        const base = process.env["MEDIA_PUBLISH_BASE"]?.trim().replace(/\/+$/, "");
        if (!base?.startsWith("rtsp://"))
          return json({ erro: "Retransmissor RTSP não configurado na VPS." }, 503);

        const { novoPath, assinarToken } = await import("@/lib/media.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { dvr_id, canal, minutos, aguardar } = p.data;
        const expira = new Date(Date.now() + minutos * 60_000).toISOString();

        const ativas = async () => {
          const { data } = await supabaseAdmin
            .from("video_sessions")
            .select("id, estado, path, expires_at, diagnostico")
            .eq("dvr_id", dvr_id)
            .eq("canal", canal)
            .eq("modo", "publicacao")
            .in("estado", ["solicitada", "conectando", "publicando"])
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: true })
            .limit(1);
          return data ?? [];
        };

        const [{ data: permitido }, { data: dvr }, existentes] = await Promise.all([
          r.auth.client.from("dvrs").select("id").eq("id", dvr_id).maybeSingle(),
          supabaseAdmin.from("dvrs").select("id, servidor_id, ativo").eq("id", dvr_id).maybeSingle(),
          ativas(),
        ]);
        if (!permitido) return json({ erro: "DVR não encontrado." }, 404);
        if (!dvr || !dvr.ativo || !dvr.servidor_id)
          return json({ erro: "DVR inativo ou sem servidor vinculado." }, 400);

        type Sessao = {
          id: string;
          estado: string;
          path: string;
          expires_at: string;
          diagnostico: string | null;
        };
        let sessao: Sessao | undefined = existentes[0];
        if (sessao) {
          // Reaproveita a publicação existente e estende até o fim pedido.
          if (new Date(sessao.expires_at) < new Date(expira)) {
            await supabaseAdmin.from("video_sessions").update({ expires_at: expira }).eq("id", sessao.id);
            sessao = { ...sessao, expires_at: expira };
          }
        } else {
          const { data, error } = await supabaseAdmin
            .from("video_sessions")
            .insert({
              servidor_id: dvr.servidor_id,
              dvr_id,
              canal,
              solicitado_por: r.auth.userId,
              path: novoPath(),
              estado: "solicitada",
              espectadores: 1,
              expires_at: expira,
            })
            .select("id, estado, path, expires_at, diagnostico")
            .single();
          if (error || !data) return json({ erro: "Falha ao solicitar o vídeo." }, 500);
          sessao = data;
        }
        if (!sessao) return json({ erro: "Falha ao solicitar o vídeo." }, 500);

        // Aguarda o Agent começar a publicar (padrão até 20 s) para o link já
        // tocar. Consultas mais frequentes = resposta mais rápida quando a
        // imagem sobe; com aguardar=0 responde na hora e o VLC conecta depois.
        const limite = Date.now() + aguardar * 1000;
        while (sessao.estado !== "publicando" && Date.now() < limite) {
          await new Promise((ok) => setTimeout(ok, 250));
          const { data }: { data: Sessao | null } = await supabaseAdmin
            .from("video_sessions")
            .select("id, estado, path, expires_at, diagnostico")
            .eq("id", sessao.id)
            .maybeSingle();
          if (!data) break;
          sessao = data;
          if (data.estado === "erro" || data.estado === "encerrada")
            return json({ erro: data.diagnostico ?? "Vídeo indisponível para esta câmera." }, 502);
        }

        const exp = Math.floor(new Date(sessao.expires_at).getTime() / 1000) + 300;
        const token = assinarToken({ p: sessao.path, a: "read", sid: sessao.id, exp });
        const pronto = sessao.estado === "publicando";
        return json(
          {
            dvr_id,
            canal,
            estado: pronto ? "publicando" : "preparando",
            rtsp: `${base}/${sessao.path}?token=${token}`,
            expira_em: sessao.expires_at,
            observacao: pronto
              ? "Abra no VLC: Mídia → Abrir fluxo de rede."
              : "O Agent ainda está preparando; o link passa a tocar em alguns segundos.",
          },
          pronto ? 200 : 202,
        );
      },
    },
  },
});
