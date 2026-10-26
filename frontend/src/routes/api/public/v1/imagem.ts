import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  dvr_id: z.string().uuid(),
  canal: z.coerce.number().int().min(1).max(512),
});

export const Route = createFileRoute("/api/public/v1/imagem")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      GET: async ({ request }) => {
        const { json, exigirUsuario } = await import("@/lib/api-publica.server");
        const r = await exigirUsuario(request);
        if (r.erro) return r.erro;
        const q = new URL(request.url).searchParams;
        const p = schema.safeParse({ dvr_id: q.get("dvr_id"), canal: q.get("canal") });
        if (!p.success) return json({ erro: "Informe dvr_id e canal." }, 400);

        const { configMidiaInfra, novoPath, enderecosDeLeitura, assinarToken } =
          await import("@/lib/media.server");
        const { verificarPlaylist } = await import("@/lib/hls-prontidao");
        const { resolverImagem } = await import("@/lib/imagem-fluxo");
        if (!configMidiaInfra())
          return json({ erro: "Retransmissor de vídeo não configurado." }, 503);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { dvr_id, canal } = p.data;

        const ativas = async () => {
          const { data } = await supabaseAdmin
            .from("video_sessions")
            .select("id, estado, path, expires_at")
            .eq("dvr_id", dvr_id)
            .eq("canal", canal)
            .eq("modo", "publicacao")
            .in("estado", ["solicitada", "conectando", "publicando"])
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: true })
            .limit(1);
          return data ?? [];
        };

        // Leituras independentes em paralelo (cada ida ao banco custa ~600 ms).
        const [{ data: permitido }, { data: dvr }, primeiras] = await Promise.all([
          r.auth.client.from("dvrs").select("id").eq("id", dvr_id).maybeSingle(),
          supabaseAdmin
            .from("dvrs")
            .select("id, servidor_id, ativo")
            .eq("id", dvr_id)
            .maybeSingle(),
          ativas(),
        ]);
        if (!permitido) return json({ erro: "DVR não encontrado." }, 404);
        if (!dvr || !dvr.ativo || !dvr.servidor_id)
          return json({ erro: "DVR inativo ou sem servidor vinculado." }, 400);

        const semEspera = /^(nao|não|0|false)$/i.test(q.get("aguardar") ?? "");
        let primeiraLeitura: typeof primeiras | null = primeiras;

        const res = await resolverImagem(
          {
            ativas: async () => {
              if (primeiraLeitura) {
                const x = primeiraLeitura;
                primeiraLeitura = null;
                return x;
              }
              return ativas();
            },
            renovar: async (id, expiraEm) => {
              await supabaseAdmin
                .from("video_sessions")
                .update({ expires_at: expiraEm })
                .eq("id", id);
            },
            criar: async (path, expiraEm) => {
              const { data, error } = await supabaseAdmin
                .from("video_sessions")
                .insert({
                  servidor_id: dvr.servidor_id!,
                  dvr_id: dvr.id,
                  canal,
                  solicitado_por: r.auth.userId,
                  path,
                  estado: "solicitada",
                  espectadores: 1,
                  expires_at: expiraEm,
                })
                .select("id, estado, path, expires_at")
                .single();
              return error ? null : data;
            },
            encerrar: async (id) => {
              await supabaseAdmin
                .from("video_sessions")
                .update({ estado: "encerrada" })
                .eq("id", id);
            },
            ler: async (id) => {
              const { data } = await supabaseAdmin
                .from("video_sessions")
                .select("id, estado, path, diagnostico, expires_at")
                .eq("id", id)
                .maybeSingle();
              return data;
            },
            // Token curto assinado localmente; host interno fixo. Nada é logado.
            probe: (id, path, timeoutMs) =>
              verificarPlaylist(
                path,
                assinarToken({
                  p: path,
                  a: "read",
                  sid: id,
                  exp: Math.floor(Date.now() / 1000) + 60,
                }),
                { timeoutMs },
              ),
            links: (id, path, expiraEm) =>
              enderecosDeLeitura({ sessionId: id, path, whep: null, hls: null, expiraEm }),
            novoPath,
            agora: () => Date.now(),
            dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
          },
          { semEspera },
        );
        return json(res.body, res.status);
      },
    },
  },
});
