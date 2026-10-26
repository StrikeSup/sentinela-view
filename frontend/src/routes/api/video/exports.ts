import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const idSchema = z.string().min(4).max(200);
const bodySchema = z
  .object({
    recording_id: idSchema.optional(),
    recording_ids: z.array(idSchema).min(1).max(64).optional(),
  })
  .refine((dados) => Boolean(dados.recording_id) !== Boolean(dados.recording_ids), {
    message: "Informe recording_id ou recording_ids",
  });

export const Route = createFileRoute("/api/video/exports")({
  server: {
    handlers: {
      /** Cria ou reaproveita uma ou várias exportações na mesma solicitação. */
      POST: async ({ request }) => {
        const { usuarioDaRequisicao, podeVerGravacoes } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVerGravacoes(auth.userId)))
          return new Response("Sem permissão para ver gravações", { status: 403 });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) return new Response("Dados inválidos", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          novoObjectPath,
          futuro,
          PREPARO_MINUTOS,
          RETENCAO_MINUTOS,
          LEASE_MINUTOS,
          DOWNLOAD_SEGUNDOS,
          BUCKET_GRAVACOES,
        } = await import("@/lib/exports.server");

        const ids = Array.from(
          new Set(parsed.data.recording_ids ?? (parsed.data.recording_id ? [parsed.data.recording_id] : [])),
        );
        const emLote = Boolean(parsed.data.recording_ids);
        const { data: arquivos } = await supabaseAdmin
          .from("arquivos_gravados")
          .select("id, servidor_id, dvr_id, canal, disponivel, tamanho_bytes")
          .in("id", ids);

        const agora = new Date().toISOString();
        const arquivosPorId = new Map((arquivos ?? []).map((arquivo) => [arquivo.id, arquivo]));
        const validos = ids
          .map((id) => arquivosPorId.get(id))
          .filter((arquivo): arquivo is NonNullable<typeof arquivo> => Boolean(arquivo?.dvr_id && arquivo.disponivel));

        // 1) Reaproveita todas as exportações vivas do lote.
        const { data: existentes } = await supabaseAdmin
          .from("recording_playback_exports")
          .select("id, recording_id, state, object_path, uploaded_bytes, size_bytes, error, expires_at")
          .in("recording_id", validos.map((arquivo) => arquivo.id))
          .in("state", ["requested", "preparando", "enviando", "upload_concluido", "ready"])
          .gt("expires_at", agora)
          .order("created_at", { ascending: false });

        const exportacoes = new Map<string, NonNullable<typeof existentes>[number]>();
        for (const exp of existentes ?? []) {
          // Exportações antigas em MKV não tocam no navegador: são substituídas
          // por um novo pedido em MP4.
          if (exp.object_path.toLowerCase().endsWith(".mkv")) continue;
          if (!exportacoes.has(exp.recording_id)) exportacoes.set(exp.recording_id, exp);
        }

        const faltantes = validos.filter((arquivo) => !exportacoes.has(arquivo.id));
        if (faltantes.length > 0) {
          const { data: criadas, error } = await supabaseAdmin
            .from("recording_playback_exports")
            .insert(faltantes.map((arquivo) => ({
              recording_id: arquivo.id,
              server_id: arquivo.servidor_id,
              dvr_id: arquivo.dvr_id as string,
              channel_number: arquivo.canal ?? 1,
              // Sempre MP4: a cópia exportada é convertida pelo servidor local.
              object_path: novoObjectPath(arquivo.servidor_id, arquivo.id),
              state: "requested",
              // O tamanho real é o do MP4 temporário, informado durante o envio.
              size_bytes: null,
              // Prazo maior: inclui o tempo de conversão do trecho.
              expires_at: futuro(PREPARO_MINUTOS),
            })))
            .select("id, recording_id, state, object_path, uploaded_bytes, size_bytes, error, expires_at");
          if (error || !criadas)
            return Response.json({ erro: "Falha ao criar a reprodução." }, { status: 500 });
          for (const exp of criadas) exportacoes.set(exp.recording_id, exp);
        }

        // 2) Reserva o lote inteiro para este usuário.
        const ativas = validos.flatMap((arquivo) => {
          const exp = exportacoes.get(arquivo.id);
          return exp ? [{ arquivo, exp }] : [];
        });
        if (ativas.length > 0) {
          await supabaseAdmin.from("recording_playback_leases").upsert(
            ativas.map(({ exp }) => ({
              export_id: exp.id,
              user_id: auth.userId,
              expires_at: futuro(LEASE_MINUTOS),
            })),
            { onConflict: "export_id,user_id" },
          );
          await supabaseAdmin
            .from("recording_playback_exports")
            .update({ expires_at: futuro(RETENCAO_MINUTOS) })
            .in("id", ativas.map(({ exp }) => exp.id));
        }

        const resultados = await Promise.all(ids.map(async (recordingId) => {
          const arquivo = arquivosPorId.get(recordingId);
          if (!arquivo) return { recording_id: recordingId, erro_solicitacao: "Gravação não encontrada." };
          if (!arquivo.disponivel) return { recording_id: recordingId, erro_solicitacao: "Gravação indisponível no servidor." };
          if (!arquivo.dvr_id) return { recording_id: recordingId, erro_solicitacao: "Gravação sem DVR vinculado." };
          const exp = exportacoes.get(recordingId);
          if (!exp) return { recording_id: recordingId, erro_solicitacao: "Falha ao criar a reprodução." };

          let downloadUrl: string | null = null;
          if (exp.state === "ready") {
            const { data: assinada } = await supabaseAdmin.storage
              .from(BUCKET_GRAVACOES)
              .createSignedUrl(exp.object_path, DOWNLOAD_SEGUNDOS);
            downloadUrl = assinada?.signedUrl ?? null;
          }
          return {
            recording_id: recordingId,
            export_id: exp.id,
            estado: exp.state,
            bytes_enviados: exp.uploaded_bytes ?? 0,
            tamanho_bytes: exp.size_bytes ?? null,
            erro: exp.error ?? null,
            download_url: downloadUrl,
          };
        }));

        if (emLote) {
          return Response.json({ resultados }, { headers: { "Cache-Control": "no-store" } });
        }
        const resultado = resultados[0];
        if (!resultado || "erro_solicitacao" in resultado) {
          return Response.json(
            { erro: resultado?.erro_solicitacao ?? "Gravação não encontrada." },
            { status: resultado?.erro_solicitacao === "Gravação não encontrada." ? 404 : 409 },
          );
        }
        return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
