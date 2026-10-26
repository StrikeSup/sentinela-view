// Sinalização WebRTC compartilhada entre a Visualização/Diagnóstico
// (/api/video/webrtc*) e a API das empresas parceiras (/api/public/v1/webrtc*).
// Mesmo fluxo, mesmas regras: um único lugar para as duas portas de entrada.
// Só trafegam SDP/estado; os bytes do vídeo vão direto do Agent ao navegador.
import { z } from "zod";
import { configIceServidor, corrigirDestinoIce, diagnosticarCandidatosIce } from "@/lib/ice-sdp";

type Cron = { etapa(nome: string): void; aplicar(res: Response): Response };

export const corpoOfertaSchema = z.object({
  dvr_id: z.string().uuid(),
  canal: z.number().int().min(1).max(512),
  offer_sdp: z.string().min(20).max(100_000),
  qualidade: z.enum(["extra", "principal"]).optional(),
  cliente_sessao: z.string().min(1).max(100).optional(),
  correlation_id: z.string().uuid().optional(),
});
export type CorpoOferta = z.infer<typeof corpoOfertaSchema>;

// A sessão já nasce com folga suficiente para a câmera responder e continua
// sendo renovada pelo navegador enquanto o mesmo player estiver montado.
const VALIDADE_SEGUNDOS = 180;

/** Cria (ou reaproveita) a sessão WebRTC e entrega a oferta ao Agent. */
export async function iniciarSessaoWebrtc(
  t: Cron,
  userId: string,
  dados: CorpoOferta,
): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const expires = new Date(Date.now() + VALIDADE_SEGUNDOS * 1000).toISOString();
  const aba = dados.cliente_sessao ?? null;
  // "extra" = stream secundário (mosaico), "principal" = stream principal.
  const qualidade = dados.qualidade ?? "extra";
  const correlationId = dados.correlation_id ?? crypto.randomUUID();

  // O DVR selecionado (pelo ID do cadastro) define o servidor de destino.
  // Nunca roteamos por IP/série/nome. Leituras independentes em paralelo; as
  // decisões seguem a ordem DVR ativo -> servidor ativo -> limite -> reuso.
  const [dvrRes, cameraRes, recentesRes, pendenteRes] = await Promise.all([
    supabaseAdmin
      .from("dvrs")
      .select("id, servidor_id, ativo, canais, servidores!servidor_id(id, ativo, midia_webrtc)")
      .eq("id", dados.dvr_id)
      .maybeSingle(),
    supabaseAdmin
      .from("cameras")
      .select("path, servidor_id")
      .eq("dvr_id", dados.dvr_id)
      .eq("canal", dados.canal)
      .maybeSingle(),
    aba
      ? supabaseAdmin
          .from("video_sessions")
          .select("id", { count: "exact", head: true })
          .eq("cliente_sessao", aba)
          .eq("dvr_id", dados.dvr_id)
          .eq("canal", dados.canal)
          .eq("modo", "webrtc_relay")
          .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      : Promise.resolve({ count: 0 }),
    aba
      ? supabaseAdmin
          .from("video_sessions")
          .select("id")
          .eq("cliente_sessao", aba)
          .eq("dvr_id", dados.dvr_id)
          .eq("canal", dados.canal)
          .eq("modo", "webrtc_relay")
          .eq("qualidade", qualidade)
          .is("answer_sdp", null)
          .in("estado", ["solicitada", "conectando", "aguardando_camera", "negociando"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const dvr = dvrRes.data;
  const camera = cameraRes.data;
  const servidorRel = dvr?.servidores as
    | { id: string; ativo: boolean; midia_webrtc: unknown }
    | { id: string; ativo: boolean; midia_webrtc: unknown }[]
    | null
    | undefined;
  const servidor = Array.isArray(servidorRel) ? (servidorRel[0] ?? null) : (servidorRel ?? null);

  t.etapa("db_consultas");
  if (!dvr?.ativo || !dvr.servidor_id)
    return t.aplicar(
      Response.json({ indisponivel: true, motivo: "DVR inativo ou sem servidor vinculado." }),
    );

  // Câmera ainda não catalogada: segue com dvr_id + canal (path informativo).
  const pathCamera =
    camera?.servidor_id === dvr.servidor_id && camera.path
      ? camera.path
      : `dvr_${dvr.id.replace(/-/g, "_")}_ch_${String(dados.canal).padStart(3, "0")}`;

  if (!servidor?.ativo)
    return t.aplicar(Response.json({ indisponivel: true, motivo: "Servidor de imagens inativo." }));

  // Limite: no máximo 8 pedidos por minuto da mesma aba para a câmera.
  if (aba && ((recentesRes as { count: number | null }).count ?? 0) >= 8)
    return t.aplicar(
      Response.json(
        {
          erro: "Muitas tentativas para esta câmera. Aguarde alguns segundos.",
          retry_after_ms: 15_000,
        },
        { status: 429, headers: { "Retry-After": "15" } },
      ),
    );

  if (aba) {
    // Reaproveita a solicitação pendente DESTA MESMA ABA para esta câmera.
    const pendente = (pendenteRes as { data: { id: string } | null }).data;
    if (pendente) {
      const { data: atualizada } = await supabaseAdmin
        .from("video_sessions")
        .update({
          offer_sdp: dados.offer_sdp,
          answer_sdp: null,
          diagnostico: null,
          estado: "solicitada",
          solicitado_por: userId,
          correlation_id: correlationId,
          marcos_agente: null,
          expires_at: expires,
        })
        .eq("id", pendente.id)
        .select("id, correlation_id")
        .maybeSingle();
      t.etapa("db_reuso");
      if (atualizada)
        return t.aplicar(
          Response.json({
            session_id: atualizada.id,
            correlation_id: atualizada.correlation_id,
            expires_at: expires,
          }),
        );
    }

    // Encerra apenas as sessões anteriores DESTA MESMA ABA para esta câmera.
    await supabaseAdmin
      .from("video_sessions")
      .update({ estado: "encerrada" })
      .eq("cliente_sessao", aba)
      .eq("dvr_id", dados.dvr_id)
      .eq("canal", dados.canal)
      .eq("modo", "webrtc_relay")
      .eq("qualidade", qualidade)
      .neq("estado", "encerrada");
    t.etapa("db_encerrar_anteriores");
  }

  // Cada oferta pertence a um navegador.
  const { data: criada, error } = await supabaseAdmin
    .from("video_sessions")
    .insert({
      servidor_id: servidor.id,
      dvr_id: dados.dvr_id,
      canal: dados.canal,
      solicitado_por: userId,
      path: pathCamera,
      modo: "webrtc_relay",
      qualidade,
      estado: "solicitada",
      offer_sdp: dados.offer_sdp,
      answer_sdp: null,
      diagnostico: null,
      espectadores: 1,
      expires_at: expires,
      cliente_sessao: aba,
      correlation_id: correlationId,
    })
    .select("id, correlation_id")
    .single();

  t.etapa("db_insercao");
  if (error || !criada) {
    console.error("[webrtc] falha ao criar sessão", error);
    return t.aplicar(
      Response.json({ indisponivel: true, motivo: "Não foi possível iniciar a sessão." }),
    );
  }
  return t.aplicar(
    Response.json({
      session_id: criada.id,
      correlation_id: criada.correlation_id,
      expires_at: expires,
    }),
  );
}

/** Estado da sessão e, quando pronta, a resposta SDP do Agent. */
export async function lerSessaoWebrtc(t: Cron, id: string, userId: string): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  type Sessao = {
    id: string;
    estado: string;
    diagnostico: string | null;
    answer_sdp: string | null;
    expires_at: string;
    solicitado_por: string | null;
    modo: string | null;
    entregue_em: string | null;
    correlation_id: string | null;
    marcos_agente: unknown;
    servidor_id: string;
  };
  let data: Sessao | null = null;
  try {
    const r = await supabaseAdmin
      .from("video_sessions")
      .select(
        "id, servidor_id, estado, diagnostico, answer_sdp, expires_at, solicitado_por, modo, entregue_em, correlation_id, marcos_agente",
      )
      .eq("id", id)
      .maybeSingle();
    if (r.error) throw r.error;
    data = (r.data as Sessao | null) ?? null;
  } catch (erro) {
    // Falha temporária de banco: repetir o MESMO id, nunca tratar como perdida.
    console.error("[webrtc] consulta de sessão indisponível", id, erro);
    t.etapa("db_sessao");
    return t.aplicar(
      Response.json(
        { error: "SIGNALING_TEMPORARILY_UNAVAILABLE", retryable: true, retry_after_ms: 1000 },
        { status: 503 },
      ),
    );
  }
  t.etapa("db_sessao");

  if (!data || data.modo !== "webrtc_relay")
    return t.aplicar(Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 }));
  if (data.solicitado_por && data.solicitado_por !== userId)
    return t.aplicar(new Response("Sem permissão", { status: 403 }));

  const expirada = new Date(data.expires_at).getTime() < Date.now();
  const estado = expirada && data.estado !== "encerrada" ? "encerrada" : data.estado;
  // answer_sdp presente já basta: aplicar imediatamente.
  const pronto =
    Boolean(data.answer_sdp) || estado === "resposta_pronta" || estado === "publicando";
  const servidor = data.answer_sdp
    ? (
        await supabaseAdmin
          .from("servidores")
          .select("midia_webrtc, porta_udp_externa, ip" as "midia_webrtc")
          .eq("id", data.servidor_id)
          .maybeSingle()
      ).data
    : null;
  if (data.answer_sdp) t.etapa("db_servidor");
  const answerSdp = corrigirDestinoIce(data.answer_sdp, configIceServidor(servidor as never));
  const diagnosticoIce = pronto
    ? diagnosticarCandidatosIce(data.answer_sdp, servidor?.midia_webrtc)
    : null;
  if (diagnosticoIce) console.warn("[webrtc] candidatos ICE", id, diagnosticoIce);

  const marcos = (data.marcos_agente as Record<string, unknown> | null) ?? null;
  // Agents antigos não informam: devolve null, sem presumir principal.
  const qualidadeEfetiva =
    marcos?.["qualidade_efetiva"] === "principal" || marcos?.["qualidade_efetiva"] === "extra"
      ? (marcos["qualidade_efetiva"] as string)
      : null;
  const motivoFallback =
    typeof marcos?.["motivo_fallback"] === "string" ? (marcos["motivo_fallback"] as string) : null;
  return t.aplicar(
    Response.json({
      session_id: data.id,
      qualidade_efetiva: qualidadeEfetiva,
      motivo_fallback: motivoFallback,
      correlation_id: data.correlation_id ?? data.id,
      marcos_agente: (data.marcos_agente as Record<string, unknown> | null) ?? null,
      estado,
      etapa: pronto ? "resposta_pronta" : data.entregue_em ? "aguardando_agente" : "na_fila",
      retry_after_ms: pronto ? 0 : 500,
      diagnostico: data.diagnostico ?? null,
      entregue_em: data.entregue_em ?? null,
      answer_sdp: pronto ? answerSdp : null,
      diagnostico_ice: diagnosticoIce,
    }),
  );
}

/** Renova a sessão; opcionalmente confirma mídia ou faz ICE restart. */
export async function renovarSessaoWebrtc(
  id: string,
  userId: string,
  corpo: { estado?: string; offer_sdp?: string },
): Promise<Response> {
  const patch: {
    expires_at: string;
    estado?: string;
    diagnostico?: string;
    offer_sdp?: string;
    answer_sdp?: null;
  } = { expires_at: new Date(Date.now() + 180_000).toISOString() };
  if (corpo.estado === "publicando") {
    patch.estado = "publicando";
    patch.diagnostico = `mídia confirmada pelo navegador em ${new Date().toISOString()}`;
  }
  if (typeof corpo.offer_sdp === "string" && corpo.offer_sdp.length > 0) {
    if (corpo.offer_sdp.length > 100_000)
      return new Response("Oferta muito grande", { status: 400 });
    patch.offer_sdp = corpo.offer_sdp;
    patch.answer_sdp = null;
    patch.estado = "negociando";
    patch.diagnostico = `ICE restart solicitado pelo navegador em ${new Date().toISOString()}`;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("video_sessions")
    .update(patch)
    .eq("id", id)
    .eq("modo", "webrtc_relay")
    .eq("solicitado_por", userId)
    .neq("estado", "encerrada")
    .select("id, estado")
    .maybeSingle();

  if (!data) return new Response("Sessão não encontrada", { status: 404 });
  return Response.json({ session_id: data.id, estado: data.estado });
}

/** Encerra só a sessão deste espectador. */
export async function encerrarSessaoWebrtc(id: string, userId: string): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("video_sessions")
    .update({ estado: "encerrada", espectadores: 0, expires_at: new Date().toISOString() })
    .eq("id", id)
    .eq("modo", "webrtc_relay")
    .eq("solicitado_por", userId);
  return new Response(null, { status: 204 });
}

const VALIDADE_ICE_SEGUNDOS = 6 * 60 * 60;

function listar(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** STUN/TURN com credenciais temporárias; o segredo nunca sai do servidor. */
export async function montarIceServers(userId: string) {
  const stunEnv = listar(process.env["STUN_URLS"]);
  const stun = stunEnv.length ? stunEnv : ["stun:stun.l.google.com:19302"];
  const turn = listar(process.env["TURN_URLS"]);
  const iceServers: RTCIceServer[] = [{ urls: stun }];

  if (turn.length) {
    const segredo = process.env["TURN_SECRET"]?.trim();
    if (segredo) {
      const { createHmac } = await import("crypto");
      const username = `${Math.floor(Date.now() / 1000) + VALIDADE_ICE_SEGUNDOS}:${userId}`;
      const credential = createHmac("sha1", segredo).update(username).digest("base64");
      iceServers.push({ urls: turn, username, credential });
    } else {
      const username = process.env["TURN_USERNAME"]?.trim();
      const credential = process.env["TURN_PASSWORD"]?.trim();
      if (username && credential) iceServers.push({ urls: turn, username, credential });
      else iceServers.push({ urls: turn });
    }
  }
  return { iceServers, turn: turn.length > 0, expira_em: VALIDADE_ICE_SEGUNDOS };
}
