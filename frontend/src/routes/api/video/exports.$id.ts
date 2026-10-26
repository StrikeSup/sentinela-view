import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/video/exports/$id")({
  server: {
    handlers: {
      /** Progresso do upload e, quando pronto, a URL assinada de leitura. */
      GET: async ({ request, params }) => {
        const { usuarioDaRequisicao, podeVerGravacoes } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão para ver gravações", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { futuro, LEASE_MINUTOS, RETENCAO_MINUTOS, DOWNLOAD_SEGUNDOS, BUCKET_GRAVACOES } =
          await import("@/lib/exports.server");

        const { data: exp } = await supabaseAdmin
          .from("recording_playback_exports")
          .select("id, state, object_path, uploaded_bytes, size_bytes, error, etapa, ready_at")
          .eq("id", params.id)
          .maybeSingle();
        if (!exp) return Response.json({ erro: "Reprodução não encontrada." }, { status: 404 });

        // Renova a reserva e a retenção enquanto o player estiver aberto.
        await supabaseAdmin.from("recording_playback_leases").upsert(
          { export_id: exp.id, user_id: auth.userId, expires_at: futuro(LEASE_MINUTOS) },
          { onConflict: "export_id,user_id" },
        );
        await supabaseAdmin
          .from("recording_playback_exports")
          .update({ expires_at: futuro(RETENCAO_MINUTOS) })
          .eq("id", exp.id);

        let estado = exp.state;

        // Alguns servidores locais enviam o arquivo sem avisar o progresso.
        // Por isso conferimos o armazenamento em qualquer estado: se o objeto
        // já existe, a gravação está pronta para tocar.
        if (estado !== "ready" && estado !== "erro") {
          const pasta = exp.object_path.split("/").slice(0, -1).join("/");
          const nome = exp.object_path.split("/").pop() ?? "";
          const { data: lista } = await supabaseAdmin.storage
            .from(BUCKET_GRAVACOES)
            .list(pasta, { search: nome, limit: 1 });
          const objeto = lista?.find((o) => o.name === nome);
          if (objeto) {
            estado = "ready";
            await supabaseAdmin
              .from("recording_playback_exports")
              .update({
                state: "ready",
                ready_at: new Date().toISOString(),
                size_bytes:
                  (objeto.metadata as { size?: number } | null)?.size ?? exp.size_bytes ?? null,
              })
              .eq("id", exp.id);
          }
        }

        let downloadUrl: string | null = null;
        if (estado === "ready") {
          const { data: assinada } = await supabaseAdmin.storage
            .from(BUCKET_GRAVACOES)
            .createSignedUrl(exp.object_path, DOWNLOAD_SEGUNDOS);
          downloadUrl = assinada?.signedUrl ?? null;
        }

        return Response.json(
          {
            export_id: exp.id,
            estado,
            etapa: exp.etapa ?? null,
            bytes_enviados: exp.uploaded_bytes ?? 0,
            tamanho_bytes: exp.size_bytes ?? null,
            erro: exp.error ?? null,
            download_url: downloadUrl,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },

      /** Ao fechar o player: libera a reserva e, com ?apagar=1, remove o arquivo. */
      DELETE: async ({ request, params }) => {
        const { usuarioDaRequisicao } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        const { liberarLease, apagarExport } = await import("@/lib/exports.server");
        await liberarLease(params.id, auth.userId);

        const apagar = new URL(request.url).searchParams.get("apagar") === "1";
        if (apagar) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Só apaga quando ninguém mais está assistindo a este arquivo.
          const { count } = await supabaseAdmin
            .from("recording_playback_leases")
            .select("id", { count: "exact", head: true })
            .eq("export_id", params.id)
            .gt("expires_at", new Date().toISOString());
          if (!count) {
            const { data: exp } = await supabaseAdmin
              .from("recording_playback_exports")
              .select("id, object_path")
              .eq("id", params.id)
              .maybeSingle();
            if (exp) await apagarExport(exp.id, exp.object_path);
          }
        }
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
