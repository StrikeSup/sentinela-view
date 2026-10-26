import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Plano de controle das sessões de vídeo sob demanda.
// O agente pergunta o que precisa publicar (GET) e informa o que observou (POST).
const postSchema = z.object({
  sessoes: z
    .array(
      z.object({
        id: z.string().uuid(),
        estado: z.enum([
          "conectando",
          "aguardando_camera",
          "negociando",
          "resposta_pronta",
          "publicando",
          "erro",
          // upload de gravação para o armazenamento temporário
          "preparando",
          // conversão da cópia exportada para MP4/H.264 (alpha 44)
          "convertendo_mp4",
          "enviando",
          "upload_concluido",
        ]),
        modo: z.string().max(40).optional(),
        bytes_enviados: z.number().int().min(0).optional(),
        tamanho_bytes: z.number().int().min(0).optional(),
        progresso_percentual: z.number().min(0).max(100).optional(),
        upload_iniciado_em: z.string().max(80).optional(),
        answer_sdp: z.string().max(100_000).optional(),
        dvr_id: z.string().uuid().optional(),
        canal: z.number().int().min(1).max(512).optional(),
        reconexoes: z.number().int().min(0).max(100000).optional(),
        diagnostico: z.string().max(500).optional(),
        publicacao: z.string().max(500).optional(),
        etapa: z.string().max(80).optional(),
        solicitacao_recebida_em: z.string().max(80).optional(),
        tentativa_publicacao_em: z.string().max(80).optional(),
        // Marcos de desempenho do Agent 1.0.53+ (opcionais em agentes antigos)
        correlation_id: z.string().uuid().optional(),
        rtsp_iniciado_em: z.string().max(80).optional(),
        publicacao_pronta_em: z.string().max(80).optional(),
        whep_iniciado_em: z.string().max(80).optional(),
        answer_sdp_gerado_em: z.string().max(80).optional(),
        tempo_resposta_ms: z.number().min(0).max(3_600_000).optional(),
        tentativas: z.number().int().min(0).max(100000).optional(),
        processo_iniciado: z.boolean().optional(),
        video_publicado: z.boolean().optional(),
        source_ready: z.boolean().optional(),
        // RTSP pronto não significa vídeo aceito pelo navegador: guardamos os
        // dois sinais separados para não marcar a câmera como visível cedo.
        rtsp_pronto: z.boolean().optional(),
        webrtc_pronto: z.boolean().optional(),
        codec: z.string().max(60).optional(),
        // Agent Next 1.0.15+: stream realmente aberto e motivo do fallback.
        qualidade_efetiva: z.enum(["extra", "principal"]).optional(),
        motivo_fallback: z.string().max(300).optional(),
        // endereços de leitura entregues pelo próprio servidor local
        whep_url: z.string().url().max(1000).optional(),
        hls_url: z.string().url().max(1000).optional(),
        playback_url: z.string().url().max(1000).optional(),
        recording_id: z.string().max(200).optional(),
      }),
    )
    .max(200),
});

/**
 * Agentes enviam `null` em campos que ainda não têm valor. Remover esses
 * campos antes de validar evita rejeitar o relatório inteiro por causa de um
 * campo vazio (era a causa dos HTTP 400 "Dados inválidos").
 */
function semNulos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semNulos);
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      saida[chave] = semNulos(v);
    }
    return saida;
  }
  return valor;
}

/** Tipo de conteúdo do envio, deduzido da extensão do objeto no armazenamento. */
function tipoDoArquivo(caminho: string): string {
  if (caminho.toLowerCase().endsWith(".mp4")) return "video/mp4";
  return "video/x-matroska";
}

const AVISO_RELAY =
  "Transmissão indisponível: o sistema ainda não tem um destino público de vídeo configurado. Peça ao administrador para configurar o relay de mídia.";



function chave(request: Request) {
  return (
    request.headers.get("x-agente-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

/**
 * A licença é conferida no banco e guardada por 60 segundos. O agente consulta
 * a fila várias vezes por segundo; sem esse cache cada consulta gastava uma ida
 * e volta extra ao banco, atrasando a abertura das câmeras.
 */
const cacheLicenca = new Map<string, { id: string | null; ate: number }>();

async function autenticar(request: Request) {
  const licenca = new URL(request.url).searchParams.get("licenca") ?? "";
  const token = chave(request);
  if (!licenca || !token) return null;
  const chaveCache = `${licenca}::${token}`;
  const guardado = cacheLicenca.get(chaveCache);
  if (guardado && guardado.ate > Date.now()) return guardado.id;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("servidores")
    .select("id")
    .eq("licenca", licenca)
    .eq("token", token)
    .eq("ativo", true)
    .maybeSingle();
  const id = data?.id ?? null;
  cacheLicenca.set(chaveCache, { id, ate: Date.now() + (id ? 60_000 : 5_000) });
  if (cacheLicenca.size > 200) cacheLicenca.clear();
  return id;
}

/** Prioridade da fila: principal solicitado ultrapassa o mosaico ainda pendente. */
function prioridade(modo: string | null, estado: string, qualidade?: string | null): number {
  if (modo === "webrtc_relay" && qualidade === "principal" && estado === "solicitada") return 0;
  const gravacao = modo === "recording_webrtc" || modo === "recording_hls";
  if (gravacao && estado === "solicitada") return 1;
  if (estado === "solicitada") return 2;
  if (estado === "conectando" || estado === "negociando" || estado === "aguardando_camera") return 3;
  return 4;
}

function chaveOrdem(p: number, createdAt: string, id: string) {
  return `${p}|${createdAt}|${id}`;
}

function lerCursor(valor: string | null): string | null {
  if (!valor) return null;
  try {
    return atob(valor);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/agente/streams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const servidorId = await autenticar(request);
        if (!servidorId) return new Response("Licença ou chave inválida", { status: 401 });

        const url = new URL(request.url);
        const limitBruto = Number(url.searchParams.get("limit") ?? "200");
        const limit = Number.isFinite(limitBruto)
          ? Math.min(200, Math.max(1, Math.floor(limitBruto)))
          : 200;
        const cursor = lerCursor(url.searchParams.get("cursor"));

        const { configMidiaInfra, assinarToken } = await import("@/lib/media.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const config = configMidiaInfra();

        // Long polling: o agente pode pedir ?wait=25 e a requisição fica aberta
        // até surgir trabalho novo. Assim a solicitação do navegador chega ao
        // servidor local em menos de um segundo, sem precisar de porta aberta
        // nem de certificado local — é sempre uma conexão de saída do agente.
        const waitBruto = Number(url.searchParams.get("wait") ?? "0");
        const waitSegundos = Number.isFinite(waitBruto)
          ? Math.min(25, Math.max(0, Math.floor(waitBruto)))
          : 0;
        if (waitSegundos > 0 && !cursor) {
          const limite = Date.now() + waitSegundos * 1000;
          for (;;) {
            const agoraIso = new Date().toISOString();
            const [{ count: pendentes }, { count: envios }] = await Promise.all([
              supabaseAdmin
                .from("video_sessions")
                .select("id", { count: "exact", head: true })
                .eq("servidor_id", servidorId)
                .in("estado", ["solicitada", "conectando", "aguardando_camera", "negociando"])
                .gt("expires_at", agoraIso),
              supabaseAdmin
                .from("recording_playback_exports")
                .select("id", { count: "exact", head: true })
                .eq("server_id", servidorId)
                .in("state", ["requested", "preparando", "enviando"])
                .gt("expires_at", agoraIso),
            ]);
            if ((pendentes ?? 0) > 0 || (envios ?? 0) > 0) break;
            if (Date.now() >= limite) break;
            await new Promise((r) => setTimeout(r, 700));
          }
        }

        const agora = new Date();
        // Encerra o que expirou em paralelo com a leitura: a própria consulta
        // já ignora sessões vencidas, então não é preciso esperar essa limpeza
        // antes de responder ao servidor local.
        const limpeza = supabaseAdmin
          .from("video_sessions")
          .update({ estado: "encerrada" })
          .eq("servidor_id", servidorId)
          .lt("expires_at", agora.toISOString())
          .neq("estado", "encerrada")
          .then(
            () => undefined,
            () => undefined,
          );

        const { data: todas } = await supabaseAdmin
          .from("video_sessions")
          .select(
            "id, dvr_id, canal, estado, path, expires_at, created_at, modo, qualidade, entrega, offer_sdp, answer_sdp, recording_id, hls_url, acao_reproducao, posicao_segundos, comando_em, velocidade, correlation_id",
          )
          .eq("servidor_id", servidorId)
          // mantém a sessão visível ao agente também depois da resposta SDP,
          // para ele não derrubar a transmissão já negociada
          .in("estado", [
            "solicitada",
            "conectando",
            "aguardando_camera",
            "negociando",
            "resposta_pronta",
            "publicando",
          ])
          .gt("expires_at", agora.toISOString())
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(0, 1999);

        void limpeza;
        const linhas = todas ?? [];

        // Sem relay público configurado não existe destino de publicação:
        // marca as sessões de publicação como erro em vez de devolver um
        // publish_url vazio ao agente.
        const publicacao = linhas.filter(
          (s) =>
            s.modo !== "webrtc_relay" &&
            s.modo !== "recording_hls" &&
            s.modo !== "recording_webrtc",
        );
        if (!config && publicacao.length > 0) {
          await supabaseAdmin
            .from("video_sessions")
            .update({
              estado: "erro",
              diagnostico: AVISO_RELAY,
              ultimo_sinal_agente: agora.toISOString(),
            })
            .in(
              "id",
              publicacao.map((s) => s.id),
            );
        }

        type Item = { ordem: string; payload: Record<string, unknown> };
        const itens: Item[] = [];

        for (const s of linhas) {
          const ordem = chaveOrdem(
            prioridade(s.modo, s.estado, s.qualidade),
            s.created_at ?? s.expires_at,
            s.id,
          );
          if (s.modo === "webrtc_relay" && s.offer_sdp) {
            itens.push({
              ordem,
              payload: {
                id: s.id,
                correlation_id: s.correlation_id ?? s.id,
                modo: "webrtc_relay",
                dvr_id: s.dvr_id,
                canal: s.canal,
                path: s.path,
                // "extra" = stream secundário; "principal" = stream principal.
                qualidade: s.qualidade ?? "extra",
                // O agente deve iniciar esta oferta antes das extras pendentes.
                prioridade: s.qualidade === "principal" ? 0 : 2,
                // Sessão já respondida continua listada (para o agente manter a
                // publicação viva), porém SEM a oferta.
                offer_sdp: s.answer_sdp ? null : s.offer_sdp,
                ja_respondida: !!s.answer_sdp,
                estado: s.estado,
                expires_at: s.expires_at,
              },
            });
          } else if (s.modo === "recording_hls" && s.recording_id) {
            itens.push({
              ordem,
              payload: {
                id: s.id,
                modo: "recording_hls",
                recording_id: s.recording_id,
                dvr_id: s.dvr_id,
                canal: s.canal,
                estado: s.estado,
                ja_respondida: !!s.hls_url,
                expires_at: s.expires_at,
              },
            });
          } else if (s.modo === "recording_webrtc" && s.recording_id && s.offer_sdp) {
            itens.push({
              ordem,
              payload: {
                id: s.id,
                modo: "recording_webrtc",
                recording_id: s.recording_id,
                dvr_id: s.dvr_id,
                canal: s.canal,
                path: s.path,
                offer_sdp: s.answer_sdp ? null : s.offer_sdp,
                ja_respondida: !!s.answer_sdp,
                estado: s.estado,
                acao: s.acao_reproducao,
                posicao_segundos: s.posicao_segundos,
                velocidade: s.velocidade ?? 1,
                comando_em: s.comando_em,
                expires_at: s.expires_at,
              },
            });
          } else if (config && publicacao.includes(s)) {
            const exp = Math.floor(new Date(s.expires_at).getTime() / 1000) + 60;
            const token = assinarToken({ p: s.path, a: "publish", sid: s.id, exp });
            itens.push({
              ordem,
              payload: {
                id: s.id,
                modo: "publicacao",
                dvr_id: s.dvr_id,
                canal: s.canal,
                estado: s.estado === "publicando" ? "ativa" : "solicitada",
                publish_url: `${config.publish}/${s.path}?token=${token}`,
                qualidade: s.qualidade ?? "extra",
                // "direto" (aplicativo Windows): publicar com -c copy, sem
                // conversão, mantendo H.264 ou H.265. "padrao": como hoje.
                entrega: s.entrega ?? "padrao",
                codec: s.entrega === "direto" ? "copiar" : "padrao",
                expires_at: s.expires_at,
              },
            });
          }
        }

        // Reprodução de gravação por arquivo: o agente envia o arquivo por
        // HTTPS para uma URL assinada de upload no armazenamento do sistema.
        const { BUCKET_GRAVACOES } = await import("@/lib/exports.server");
        const { data: exportacoes } = await supabaseAdmin
          .from("recording_playback_exports")
          .select("id, recording_id, dvr_id, channel_number, object_path, state, created_at, expires_at")
          .eq("server_id", servidorId)
          .in("state", ["requested", "preparando", "enviando"])
          .gt("expires_at", agora.toISOString())
          .order("created_at", { ascending: true })
          .limit(50);

        for (const e of exportacoes ?? []) {
          const { data: assinada } = await supabaseAdmin.storage
            .from(BUCKET_GRAVACOES)
            .createSignedUploadUrl(e.object_path, { upsert: true });
          if (!assinada?.signedUrl) continue;
          itens.push({
            ordem: chaveOrdem(0, e.created_at, e.id),
            payload: {
              id: e.id,
              modo: "recording_upload",
              dvr_id: e.dvr_id,
              canal: e.channel_number,
              recording_id: e.recording_id,
              upload_url: assinada.signedUrl,
              upload_headers: { "content-type": tipoDoArquivo(e.object_path) },
              // Formato esperado no envio (o navegador só toca MP4/H.264 com
              // segurança; MKV/H.265 costuma não abrir).
              formato: e.object_path.toLowerCase().endsWith(".mp4") ? "mp4" : "mkv",
              estado: e.state === "requested" ? "solicitada" : e.state,
              expires_at: e.expires_at,
            },
          });
        }
        if ((exportacoes ?? []).length > 0) {
          await supabaseAdmin
            .from("recording_playback_exports")
            .update({ entregue_em: agora.toISOString() })
            .in(
              "id",
              (exportacoes ?? []).map((e) => e.id),
            )
            .is("entregue_em", null);
        }

        itens.sort((a, b) => (a.ordem < b.ordem ? -1 : a.ordem > b.ordem ? 1 : 0));
        const total = itens.length;
        const restantes = cursor ? itens.filter((i) => i.ordem > cursor) : itens;
        const pagina = restantes.slice(0, limit);
        const hasMore = restantes.length > pagina.length;
        const ultimo = pagina[pagina.length - 1];

        // Marca como entregue: assim o painel sabe se o servidor local já
        // recebeu a solicitação, em vez de dizer que ele nunca respondeu.
        const entregues = pagina
          .map((i) => i.payload["id"] as string)
          .filter((id) => !!id);
        if (entregues.length > 0) {
          await supabaseAdmin
            .from("video_sessions")
            .update({ entregue_em: agora.toISOString() })
            .in("id", entregues)
            .is("entregue_em", null);
        }



        return Response.json(
          {
            requests: pagina.map((i) => i.payload),
            next_cursor: hasMore && ultimo ? btoa(ultimo.ordem) : null,
            has_more: hasMore,
            total,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },


      POST: async ({ request }) => {
        const servidorId = await autenticar(request);
        if (!servidorId) return new Response("Licença ou chave inválida", { status: 401 });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = postSchema.safeParse(semNulos(json));
        if (!parsed.success) {
          // Erro por campo, sem devolver SDP nem token no corpo da resposta.
          const campos = parsed.error.issues.slice(0, 20).map((i) => ({
            campo: i.path.join("."),
            motivo: i.message,
          }));
          return Response.json(
            { erro: "Dados inválidos", campos },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const agora = new Date().toISOString();

        for (const s of parsed.data.sessoes) {
          // Progresso do envio do arquivo da gravação.
          if (
            s.modo === "recording_upload" ||
            s.estado === "preparando" ||
            s.estado === "convertendo_mp4" ||
            s.estado === "enviando" ||
            s.estado === "upload_concluido"
          ) {
            // A conversão para MP4 acontece antes do envio: guardamos como
            // "preparando" e registramos a etapa real para a tela mostrar.
            const estadoExport =
              s.estado === "erro" ? "erro" : s.estado === "convertendo_mp4" ? "preparando" : s.estado;
            const etapa = s.estado === "convertendo_mp4" ? (s.etapa ?? "convertendo_mp4") : s.etapa;
            const { error: erroUpload } = await supabaseAdmin
              .from("recording_playback_exports")
              .update({
                state: estadoExport,
                ...(etapa !== undefined ? { etapa } : {}),
                ...(s.bytes_enviados !== undefined ? { uploaded_bytes: s.bytes_enviados } : {}),
                ...(s.tamanho_bytes !== undefined ? { size_bytes: s.tamanho_bytes } : {}),
                ...(s.estado === "erro" ? { error: (s.diagnostico ?? "").slice(0, 500) } : {}),
              })
              .eq("id", s.id)
              .eq("server_id", servidorId);
            if (erroUpload) {
              console.error("[agente/streams] falha ao atualizar exportação", {
                export_id: s.id,
                erro: erroUpload.message,
              });
            }
            continue;
          }

          const partes = [
            s.diagnostico,
            s.etapa ? `etapa: ${s.etapa}` : null,
            s.tentativa_publicacao_em ? `tentativa: ${s.tentativa_publicacao_em}` : null,
            s.processo_iniciado === false ? "publicador não iniciado" : null,
          ].filter(Boolean);
          const diagnostico = partes.length > 0 ? partes.join(" · ").slice(0, 500) : undefined;
          // A presença do answer_sdp é a confirmação objetiva de que a
          // sinalização terminou, mesmo quando versões anteriores do agente
          // ainda enviam o rótulo "negociando" no mesmo payload.
          const estadoPersistido = s.answer_sdp ? "resposta_pronta" : s.estado;
          // Cronologia do lado local, guardada como diagnóstico (sem SDP, IP
          // ou caminho RTSP). Agentes antigos simplesmente não enviam nada.
          const marcos: Record<string, string | number | boolean> = {};
          if (s.solicitacao_recebida_em) marcos["solicitacao_recebida_em"] = s.solicitacao_recebida_em;
          if (s.rtsp_iniciado_em) marcos["rtsp_iniciado_em"] = s.rtsp_iniciado_em;
          if (s.publicacao_pronta_em) marcos["publicacao_pronta_em"] = s.publicacao_pronta_em;
          if (s.whep_iniciado_em) marcos["whep_iniciado_em"] = s.whep_iniciado_em;
          if (s.answer_sdp_gerado_em) marcos["answer_sdp_gerado_em"] = s.answer_sdp_gerado_em;
          if (s.tempo_resposta_ms !== undefined) marcos["tempo_resposta_ms"] = s.tempo_resposta_ms;
          if (s.tentativas !== undefined) marcos["tentativas"] = s.tentativas;
          if (s.etapa) marcos["etapa"] = s.etapa;
          if (s.source_ready !== undefined) marcos["source_ready"] = s.source_ready;
          if (s.rtsp_pronto !== undefined) marcos["rtsp_pronto"] = s.rtsp_pronto;
          if (s.webrtc_pronto !== undefined) marcos["webrtc_pronto"] = s.webrtc_pronto;
          if (s.codec) marcos["codec"] = s.codec;
          if (s.qualidade_efetiva) marcos["qualidade_efetiva"] = s.qualidade_efetiva;
          if (s.motivo_fallback) marcos["motivo_fallback"] = s.motivo_fallback;
          // Preserva marcos anteriores (ex.: qualidade_efetiva enviada com o answer).
          if (Object.keys(marcos).length > 0) {
            const { data: anterior } = await supabaseAdmin
              .from("video_sessions")
              .select("marcos_agente")
              .eq("id", s.id)
              .eq("servidor_id", servidorId)
              .maybeSingle();
            const antigos = anterior?.marcos_agente;
            if (antigos && typeof antigos === "object" && !Array.isArray(antigos)) {
              for (const [k, v] of Object.entries(antigos as Record<string, unknown>)) {
                if (!(k in marcos) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
                  marcos[k] = v;
              }
            }
          }
          let q = supabaseAdmin
            .from("video_sessions")
            .update({
              estado: estadoPersistido,
              ...(s.reconexoes !== undefined ? { reconexoes: s.reconexoes } : {}),
              ...(diagnostico !== undefined ? { diagnostico } : {}),
              ...(s.answer_sdp !== undefined ? { answer_sdp: s.answer_sdp } : {}),
              ...(s.whep_url !== undefined ? { whep_url: s.whep_url } : {}),
              ...(s.hls_url !== undefined ? { hls_url: s.hls_url } : {}),
              ...(s.playback_url !== undefined ? { hls_url: s.playback_url } : {}),
              ...(s.correlation_id ? { correlation_id: s.correlation_id } : {}),
              ...(Object.keys(marcos).length > 0 ? { marcos_agente: marcos } : {}),
              ultimo_sinal_agente: agora,
            })
            .eq("id", s.id)
            .eq("servidor_id", servidorId)
            // Uma resposta atrasada do agente nunca pode reabrir uma sessão
            // que o navegador encerrou ou que já perdeu sua validade.
            .neq("estado", "encerrada")
            .gt("expires_at", agora);
          // Depois que o navegador confirma mídia, respostas repetidas da
          // negociação não podem rebaixar a sessão ativa.
          if (s.estado !== "publicando") {
            q = q.neq("estado", "publicando");
          }
          // O UUID é a identidade única da sessão. DVR/canal enviados pelo
          // agente são apenas diagnóstico e nunca redirecionam nem bloqueiam
          // a gravação do answer_sdp da sessão indicada em sessoes[].id.
          const { data: atualizada, error } = await q.select("id").maybeSingle();
          if (error) {
            console.error("[agente/streams] falha ao atualizar sessão pelo ID", {
              session_id: s.id,
              servidor_id: servidorId,
              erro: error.message,
            });
          } else if (!atualizada) {
            console.warn("[agente/streams] sessão recebida não foi atualizada", {
              session_id: s.id,
              servidor_id: servidorId,
              estado_recebido: s.estado,
            });
          }
        }

        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
