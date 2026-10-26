import { supabase } from "@/integrations/supabase/client";
import { lerServerTiming } from "@/lib/server-timing";

/** Durações do servidor (Server-Timing), só números; opcional. */
export type ServerTiming = Record<string, number>;

/** "extra" = stream secundário (mosaico); "principal" = stream principal. */
export type QualidadeVideo = "extra" | "principal";

export type EstadoWebrtc =
  | "solicitada"
  | "conectando"
  | "aguardando_camera"
  | "negociando"
  | "resposta_pronta"
  | "publicando"
  | "erro"
  | "encerrada";

/**
 * Carimbo único desta janela. Janelas abertas por outra janela copiam o
 * `sessionStorage` de quem as abriu — sem este carimbo, duas janelas ficariam
 * com a mesma identificação e uma sobrescreveria o registro da outra.
 */
export function carimboDaJanela(): string {
  if (typeof window === "undefined") return "ssr";
  if (!window.name) window.name = `sentinela-janela-${crypto.randomUUID()}`;
  return window.name;
}

/**
 * Identificador desta aba/janela. Duas telas do MESMO usuário (outra aba,
 * outro monitor) precisam ter transmissões independentes — sem isso, abrir a
 * câmera em um lugar encerrava a sessão aberta no outro.
 */
export function idDaAba(): string {
  if (typeof window === "undefined") return "ssr";
  const chave = "sentinela_aba_id";
  const carimbo = carimboDaJanela();
  let id: string | null = null;
  try {
    const bruto = sessionStorage.getItem(chave);
    if (bruto) {
      const salvo = JSON.parse(bruto) as { id?: string; carimbo?: string };
      // herdado de outra janela: vale só para quem gravou
      if (salvo?.id && salvo.carimbo === carimbo) id = salvo.id;
    }
  } catch {
    id = null;
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      sessionStorage.setItem(chave, JSON.stringify({ id, carimbo }));
    } catch {
      /* ignora */
    }
  }
  return id;
}

async function auth(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ResultadoAbertura =
  | { tipo: "ok"; session_id: string; correlation_id: string | null; server_timing?: ServerTiming }
  /** Servidor respondeu que não há vídeo direto (DVR/servidor inativo). */
  | { tipo: "indisponivel"; motivo: string; server_timing?: ServerTiming }
  /** 401/403: sem sessão ou sem permissão; não adianta repetir. */
  | { tipo: "negado"; status: number; server_timing?: ServerTiming }
  /** 429: respeitar Retry-After. */
  | { tipo: "limite"; retryAfterMs: number; server_timing?: ServerTiming }
  /** Rede/5xx: repetir com espera. */
  | { tipo: "transitorio"; status: number; server_timing?: ServerTiming };

/** Envia a oferta SDP e classifica a resposta sem mascarar o motivo. */
export async function abrirWebrtc(
  dvrId: string,
  canal: number,
  offerSdp: string,
  qualidade: QualidadeVideo = "extra",
  correlationId?: string,
  sinal?: AbortSignal,
): Promise<ResultadoAbertura> {
  let res: Response;
  try {
    res = await fetch("/api/video/webrtc", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify({
        dvr_id: dvrId,
        canal,
        offer_sdp: offerSdp,
        qualidade,
        cliente_sessao: idDaAba(),
        ...(correlationId ? { correlation_id: correlationId } : {}),
      }),
      ...(sinal ? { signal: sinal } : {}),
    });
  } catch {
    return { tipo: "transitorio", status: 0 };
  }
  const server_timing = lerServerTiming(res.headers.get("Server-Timing"));
  const r = await classificarAbertura(res);
  return server_timing ? { ...r, server_timing } : r;
}

async function classificarAbertura(res: Response): Promise<ResultadoAbertura> {
  if (res.status === 401 || res.status === 403) return { tipo: "negado", status: res.status };
  if (res.status === 429) {
    const cabecalho = Number(res.headers.get("Retry-After"));
    let ms = Number.isFinite(cabecalho) && cabecalho > 0 ? cabecalho * 1000 : 15_000;
    try {
      const j = (await res.json()) as { retry_after_ms?: number };
      if (typeof j.retry_after_ms === "number" && j.retry_after_ms > 0) ms = j.retry_after_ms;
    } catch {
      /* sem corpo */
    }
    return { tipo: "limite", retryAfterMs: ms };
  }
  if (res.status >= 500 || res.status === 408) return { tipo: "transitorio", status: res.status };
  if (!res.ok) return { tipo: "indisponivel", motivo: `HTTP ${res.status}` };
  try {
    const json = (await res.json()) as {
      session_id?: string;
      correlation_id?: string | null;
      indisponivel?: boolean;
      motivo?: string;
    };
    if (json.indisponivel || !json.session_id)
      return { tipo: "indisponivel", motivo: json.motivo ?? "servidor sem vídeo direto" };
    return { tipo: "ok", session_id: json.session_id, correlation_id: json.correlation_id ?? null };
  } catch {
    return { tipo: "transitorio", status: res.status };
  }
}

/** Marcos de tempo informados pelo servidor local (Agent 1.0.53+). */
export type MarcosAgente = {
  solicitacao_recebida_em?: string | null;
  rtsp_iniciado_em?: string | null;
  publicacao_pronta_em?: string | null;
  whep_iniciado_em?: string | null;
  answer_sdp_gerado_em?: string | null;
  tempo_resposta_ms?: number | null;
  tentativas?: number | null;
  etapa?: string | null;
  source_ready?: boolean | null;
};

export type RespostaSessao =
  | {
      tipo: "ok";
      estado: EstadoWebrtc;
      answer_sdp: string | null;
      diagnostico: string | null;
      entregue_em?: string | null;
      retry_after_ms?: number;
      correlation_id?: string | null;
      marcos_agente?: MarcosAgente | null;
      diagnostico_ice?: string | null;
      server_timing?: ServerTiming;
    }
  /** A sessão não existe mais no servidor: é preciso criar outra. */
  | { tipo: "ausente" }
  /** Falha temporária (rede, 5xx, abort): repetir o MESMO id. */
  | { tipo: "transitorio"; status: number }
  /** Sem autorização: não adianta repetir. */
  | { tipo: "negado"; status: number };

export async function respostaWebrtc(id: string, sinal?: AbortSignal): Promise<RespostaSessao> {
  let res: Response;
  try {
    res = await fetch(`/api/video/webrtc/${id}`, {
      headers: await auth(),
      ...(sinal ? { signal: sinal } : {}),
    });
  } catch {
    return { tipo: "transitorio", status: 0 };
  }
  if (res.status === 404) return { tipo: "ausente" };
  if (res.status === 401 || res.status === 403) return { tipo: "negado", status: res.status };
  if (!res.ok) return { tipo: "transitorio", status: res.status };
  try {
    const json = (await res.json()) as {
      estado: EstadoWebrtc;
      answer_sdp: string | null;
      diagnostico: string | null;
      entregue_em?: string | null;
      retry_after_ms?: number;
      correlation_id?: string | null;
      marcos_agente?: MarcosAgente | null;
    };
    const server_timing = lerServerTiming(res.headers.get("Server-Timing"));
    return { tipo: "ok", ...json, ...(server_timing ? { server_timing } : {}) };
  } catch {
    return { tipo: "transitorio", status: res.status };
  }
}

/** Telemetria sanitizada de desempenho (sem SDP, IP ou credenciais). */
export async function enviarTelemetriaVideo(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/video/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Telemetria nunca pode atrapalhar a exibição do vídeo.
  }
}

/** Renova a validade da sessão de controle (chamar antes dos 60 s). */
export async function renovarWebrtc(id: string, publicando = false): Promise<boolean> {
  try {
    const res = await fetch(`/api/video/webrtc/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify(publicando ? { estado: "publicando" } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Envia uma nova oferta (ICE restart) para a mesma sessão, sem gerar outro ID. */
export async function reofertarWebrtc(id: string, offerSdp: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/video/webrtc/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify({ offer_sdp: offerSdp }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function encerrarWebrtc(id: string): Promise<void> {
  await fetch(`/api/video/webrtc/${id}`, { method: "DELETE", headers: await auth() });
}

/**
 * Aguarda a coleta inicial de candidatos ICE (com limite de tempo).
 *
 * A alocação TURN exige uma ida adicional ao retransmissor. Em enlaces
 * externos/VPN, 2,5 s encerravam a coleta antes de o candidato `relay` entrar
 * no SDP. Como este fluxo não usa trickle ICE, candidatos que chegam depois do
 * envio da oferta são perdidos; por isso damos tempo suficiente para o TURN.
 */
export function esperarIce(pc: RTCPeerConnection, limiteMs = 6000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const pronto = () => {
      pc.removeEventListener("icegatheringstatechange", aoMudar);
      clearTimeout(t);
      resolve();
    };
    const aoMudar = () => {
      if (pc.iceGatheringState === "complete") pronto();
    };
    const t = setTimeout(pronto, limiteMs);
    pc.addEventListener("icegatheringstatechange", aoMudar);
  });
}

/**
 * Diz se a câmera JÁ está publicando para outro espectador.
 *
 * Quando alguém já está vendo o canal, o servidor local não precisa abrir
 * outra conexão no DVR: a publicação está quente e a resposta costuma chegar
 * em poucos segundos. Nesse caso a nossa solicitação pode furar a fila de
 * negociação, dando a sensação de imagem instantânea sem sobrecarregar nada.
 *
 * Resultado fica em cache por 5 s para um mosaico grande não disparar uma
 * consulta por quadro.
 */
const cacheQuente = new Map<string, { em: number; quente: boolean }>();
const VALIDADE_CACHE_MS = 5_000;
/** Estados em que a publicação já existe no servidor local. */
const ESTADOS_QUENTES = ["publicando", "resposta_pronta", "negociando"];

export async function cameraJaPublicando(
  dvrId: string,
  canal: number,
  qualidade: QualidadeVideo = "extra",
): Promise<boolean> {
  const chave = `${dvrId}:${canal}:${qualidade}`;
  const agora = Date.now();
  const guardado = cacheQuente.get(chave);
  if (guardado && agora - guardado.em < VALIDADE_CACHE_MS) return guardado.quente;
  let quente = false;
  try {
    const limite = new Date(agora - 60_000).toISOString();
    const { data } = await supabase
      .from("video_sessions")
      .select("id")
      .eq("dvr_id", dvrId)
      .eq("canal", canal)
      .eq("qualidade", qualidade)
      .in("estado", ESTADOS_QUENTES)
      .neq("cliente_sessao", idDaAba())
      .gt("expires_at", new Date(agora).toISOString())
      .gte("updated_at", limite)
      .limit(1);
    quente = (data?.length ?? 0) > 0;
  } catch {
    quente = false;
  }
  cacheQuente.set(chave, { em: agora, quente });
  return quente;
}
