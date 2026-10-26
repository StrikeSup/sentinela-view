import { esperarSinalSessao } from "@/lib/webrtc-realtime";
import type { MarcosAgente, QualidadeVideo } from "@/lib/webrtc-sessions";
import { registrarSucesso, registrarVisualizacao } from "@/lib/video-memoria";
import { fonteEmUso, pedirEspelho, registrarFonte, removerFonte } from "@/lib/video-espelho";
import { configIce, modoRelayForcado, urlIceSegura } from "@/lib/ice";
import { aguardarMarcha } from "@/lib/marcha-conexoes";

/** Enquanto houver outro usuário vendo pelo espelho, a conexão é mantida. */
const ESPELHO_MAX_MS = 30 * 60_000;
const ESPELHO_REVISAO_MS = 30_000;
import {
  abrirWebrtc,
  cameraJaPublicando,
  encerrarWebrtc,
  enviarTelemetriaVideo,
  esperarIce,
  renovarWebrtc,
  reofertarWebrtc,
  respostaWebrtc,
} from "@/lib/webrtc-sessions";

/** Rota efetiva da mídia, classificada pelo navegador via getStats(). */
export type RotaWebrtc = "TURN" | "LAN" | "P2P" | "DIRECT_UNKNOWN" | "UNKNOWN";

/** Marcos do navegador: T0 abertura … T8 primeiro quadro na tela (ms desde T0). */
export type TemposVideo = Record<string, number>;

/**
 * Fase da política ICE desta câmera:
 * - "direto": sem STUN/TURN (iceServers vazio), só candidatos host;
 * - "completa": configIce() completa (STUN + TURN quando configurado);
 * - "relay": TURN forçado pelo operador (modoRelayForcado).
 */
export type FaseIce = "direto" | "completa" | "relay";

export function rotuloFaseIce(fase: FaseIce): string {
  if (fase === "direto") return "direto sem STUN/TURN";
  if (fase === "completa") return "fallback STUN+TURN";
  return "TURN forçado";
}

/** Prazo, após aplicar o answer da fase direta, para o primeiro quadro próprio (T8). */
const PRAZO_T8_DIRETO_MS = 20_000;
// Principal (alta resolução) demora mais para o primeiro quadro-chave: não
// derrubar a sessão cedo — o extra continua na tela até ele aparecer.
const PRAZO_T8_PRINCIPAL_MS = 60_000;
const prazoT8 = (e: { qualidade: string }) =>
  e.qualidade === "principal" ? PRAZO_T8_PRINCIPAL_MS : PRAZO_T8_DIRETO_MS;
/** Prazo para surgir um candidato host antes de enviar a oferta direta. */
const PRAZO_CANDIDATO_HOST_MS = 3_000;
/** Falha explícita de negociação que a fase direta não resolve. */
const ERRO_ICE_RE = /\b(ice|candidat\w*|stun|turn|relay)\b/i;

export type EstadoConexaoWebrtc =
  "iniciando" | "negociando" | "conectando" | "ao-vivo" | "instavel" | "aguardando-fonte" | "falha";

export type DiagnosticoConexaoWebrtc = {
  chave: string;
  sessionId: string | null;
  answerRecebido: boolean;
  erroSetRemoteDescription: string | null;
  signalingState: RTCSignalingState | null;
  connectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  bytesReceived: number;
  framesDecoded: number;
  /** Pacotes RTP recebidos (mídia chegando, mesmo sem decodificar). */
  packetsReceived: number;
  /** Quadros recebidos e quadros-chave decodificados (diagnóstico de decodificação). */
  framesReceived: number;
  keyFramesDecoded: number;
  /** Formato do vídeo recebido (ex.: video/H264, video/H265) e decodificador. */
  codec?: string | null;
  /** Quantas vezes o vídeo foi reanexado por falta de decodificação. */
  reanexos: number;
  /** Horário (ISO) em que o último quadro foi decodificado. */
  ultimoFrameEm: string | null;
  /** Horário (ISO) em que a oferta SDP desta sessão foi criada. */
  ofertaCriadaEm: string | null;
  /** Horário (ISO) em que o answer_sdp desta sessão foi aplicado. */
  answerAplicadoEm: string | null;
  /** Par ICE selecionado (tipo + endereço mascarado). */
  parIce: string | null;
  /** Motivo da última recriação de sessão desta câmera. */
  motivoReconexao: string | null;
  motivoFallback: string | null;
  /** Último diagnóstico informado pelo servidor local enquanto negocia. */
  mensagemAgente: string | null;
  /** Identificador que acompanha a mesma solicitação do início ao fim. */
  correlationId: string | null;
  /** Rota efetiva da mídia, classificada por getStats(). */
  rota: RotaWebrtc;
  tipoCandidatoLocal: string | null;
  tipoCandidatoRemoto: string | null;
  /** Marcos T0–T8 do navegador, em ms desde a abertura da câmera. */
  tempos: TemposVideo;
  /** Marcos informados pelo servidor local (quando o agente envia). */
  marcosAgente: MarcosAgente | null;
  /** Quantas vezes a imagem congelou depois de já estar ao vivo. */
  congelamentos: number;
  /** Quantidade de pedidos e conexões desta chave no navegador. */
  pedidosAtivos: number;
  conexoesAtivas: number;
  /** Tentativa diagnóstica forçada ao retransmissor (TURN). */
  modoRelay: boolean;
  /** Erros de coleta ICE/TURN (código, texto e URL sem credenciais). */
  errosIce: string[];
  /** Nova a cada RTCPeerConnection: tempos/estados/contadores são desta tentativa. */
  tentativaId: string;
  /** Como o primeiro quadro foi confirmado no elemento de vídeo. */
  confirmacaoQuadro: "requestVideoFrameCallback" | "fallback_timeupdate" | null;
  /** Diagnóstico ICE informado pelo servidor (sem IPs privados). */
  diagnosticoIce: string | null;
  /** Tentativas anteriores desta mesma ação do usuário (só para diagnóstico). */
  historico: ResumoTentativa[];
  /** Fase ICE usada nesta tentativa. */
  faseIce: FaseIce;
  /** Por que esta fase foi escolhida (sem IP/credenciais). */
  motivoFaseIce: string | null;
  /** Número da tentativa dentro da mesma ação do usuário (1, 2, ...). */
  tentativaIce: number;
};

export type EstadoEtapa = "concluida" | "aguardando" | "falhou" | "nao_observada";
export type EtapaCaminho = {
  etapa:
    | "pedido_criado"
    | "agent_recebeu"
    | "rtsp_com_midia"
    | "answer_gerado"
    | "answer_aplicado"
    | "ice_conectado"
    | "bytes_rtp_video"
    | "quadros_decodificados"
    | "primeiro_quadro_apresentado";
  estado: EstadoEtapa;
  em: number | null;
  motivo: string | null;
};
export type ResumoTentativa = {
  tentativaId: string;
  sessionId: string | null;
  tempos: TemposVideo;
  iceConnectionState: RTCIceConnectionState | null;
  bytesReceived: number;
  framesDecoded: number;
  motivo: string | null;
};

export type SnapshotWebrtc = {
  estado: EstadoConexaoWebrtc;
  stream: MediaStream | null;
  /** A imagem exibida veio do navegador de outro usuário (espelho temporário). */
  espelhado: boolean;
  diagnostico: DiagnosticoConexaoWebrtc;
};

type Ouvinte = (snapshot: SnapshotWebrtc) => void;

type Entrada = {
  chave: string;
  dvrId: string;
  canal: number;
  qualidade: QualidadeVideo;
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
  /** Vídeo da conexão própria (pode ainda não estar decodificando). */
  streamProprio: MediaStream | null;
  /** O stream exibido é o espelho de outro usuário. */
  espelhado: boolean;
  pararEspelho: (() => void) | null;
  sessionId: string | null;
  estado: EstadoConexaoWebrtc;
  diagnostico: DiagnosticoConexaoWebrtc;
  ouvintes: Set<Ouvinte>;
  referencias: number;
  iniciando: Promise<void> | null;
  cancelada: boolean;
  answerAplicado: boolean;
  renovacao: ReturnType<typeof setInterval> | null;
  monitor: ReturnType<typeof setInterval> | null;
  /** Intervalo atual (ms) da leitura de estatísticas desta câmera. */
  monitorMs: number;
  encerramento: ReturnType<typeof setTimeout> | null;
  ultimoAvancoBytes: number;
  bytesParadosDesde: number | null;
  reconexao: ReturnType<typeof setTimeout> | null;
  tentativasReconexao: number;
  ultimosFrames: number;
  desconectadoDesde: number | null;
  /** Há RTP chegando, mas nenhum quadro decodificado desde este instante. */
  semDecodificarDesde: number | null;
  /** Já foi pedida uma reanexação do vídeo para esta fase sem decodificação. */
  reanexoPedido: boolean;
  /** Já existe uma recriação pendente para esta câmera. */
  recriando: boolean;
  prioridade: number;
  /** Momento (epoch ms) em que o usuário abriu esta câmera: base dos tempos. */
  t0: number;
  correlationId: string;
  telemetriaEnviada: boolean;
  /** T8 já persistido nesta tentativa. */
  t8Enviado: boolean;
  /** Recriações desde a ação do usuário (não zera por bytes). */
  tentativasTotais: number;
  /** Até quando esperar por Retry-After (429) antes de nova oferta. */
  esperaAte: number;
  /** Invalida respostas assíncronas pertencentes a uma negociação anterior. */
  geracao: number;
  abortController: AbortController | null;
  primeiroQuadroLimite: number | null;
  /** Fase ICE da próxima/atual tentativa. Nunca volta a "direto" na mesma ação. */
  faseIce: FaseIce;
  motivoFaseIce: string | null;
  /** Fase direta: prazo (epoch ms) para o T8 após aplicar o answer. */
  hostLimiteT8: number | null;
};

const conexoes = new Map<string, Entrada>();
const MAX_NEGOCIACOES = 16;
let negociacoesAtivas = 0;
// Fila com prioridade: principal (-1), visíveis (0), pré-carregadas (1).
// A oferta principal deve sair imediatamente ao ampliar, mesmo enquanto um
// mosaico grande ainda prepara streams extras.
const filaNegociacao: Array<{ prioridade: number; resolve: () => void }> = [];

function chaveDe(dvrId: string, canal: number, qualidade: QualidadeVideo = "extra") {
  return `${dvrId}:${canal}:${qualidade}`;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Guarda o marco apenas na primeira vez (ms desde a abertura da câmera). */
function marcar(entrada: Entrada, evento: string) {
  if (entrada.diagnostico.tempos[evento] !== undefined) return;
  entrada.diagnostico.tempos[evento] = Math.max(0, Date.now() - entrada.t0);
}

function erroCompleto(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function diagnosticoNovo(chave: string): DiagnosticoConexaoWebrtc {
  return {
    chave,
    sessionId: null,
    answerRecebido: false,
    erroSetRemoteDescription: null,
    signalingState: null,
    connectionState: null,
    iceConnectionState: null,
    bytesReceived: 0,
    framesDecoded: 0,
    packetsReceived: 0,
    framesReceived: 0,
    keyFramesDecoded: 0,
    reanexos: 0,
    ultimoFrameEm: null,
    ofertaCriadaEm: null,
    answerAplicadoEm: null,
    parIce: null,
    motivoReconexao: null,
    motivoFallback: null,
    mensagemAgente: null,
    correlationId: null,
    rota: "UNKNOWN",
    tipoCandidatoLocal: null,
    tipoCandidatoRemoto: null,
    tempos: {},
    marcosAgente: null,
    congelamentos: 0,
    pedidosAtivos: 0,
    conexoesAtivas: 0,
    modoRelay: false,
    errosIce: [],
    tentativaId: uuid(),
    confirmacaoQuadro: null,
    diagnosticoIce: null,
    historico: [],
    faseIce: "direto",
    motivoFaseIce: null,
    tentativaIce: 1,
  };
}

/** Marcos da ação do usuário (valem para todas as tentativas). */
const MARCOS_DA_ACAO = ["T0", "T1", "T2"];

/**
 * Etapas do "Caminho da imagem" da tentativa atual. Sanitizado: sem SDP,
 * credenciais, tokens, URLs RTSP ou IPs privados.
 */
export function caminhoDaImagem(
  d: DiagnosticoConexaoWebrtc,
  encerrada: { falhou: boolean; motivo: string | null } = { falhou: false, motivo: null },
): EtapaCaminho[] {
  const t = d.tempos;
  const m = d.marcosAgente;
  const etapas: Array<[EtapaCaminho["etapa"], boolean | null, number | null, string | null]> = [
    ["pedido_criado", d.sessionId ? true : false, t["T3"] ?? null, null],
    [
      "agent_recebeu",
      t["T4"] !== undefined ? true : m ? Boolean(m.solicitacao_recebida_em) : false,
      t["T4"] ?? null,
      null,
    ],
    [
      "rtsp_com_midia",
      m?.source_ready === true || Boolean(m?.publicacao_pronta_em) ? true : m ? false : null,
      null,
      m?.source_ready === false ? "fonte RTSP sem mídia" : null,
    ],
    ["answer_gerado", d.answerRecebido, t["T5"] ?? null, null],
    [
      "answer_aplicado",
      Boolean(d.answerAplicadoEm),
      null,
      d.erroSetRemoteDescription ? "setRemoteDescription falhou" : null,
    ],
    [
      "ice_conectado",
      t["T6"] !== undefined,
      t["T6"] ?? null,
      d.iceConnectionState === "failed" ? "ICE failed" : d.diagnosticoIce,
    ],
    ["bytes_rtp_video", d.bytesReceived > 0, null, null],
    ["quadros_decodificados", d.framesDecoded > 0, t["T7"] ?? null, null],
    [
      "primeiro_quadro_apresentado",
      t["T8"] !== undefined,
      t["T8"] ?? null,
      d.confirmacaoQuadro === "fallback_timeupdate" ? "confirmação menos precisa (timeupdate)" : null,
    ],
  ];
  let falhaMarcada = false;
  return etapas.map(([etapa, ok, em, motivo]) => {
    if (ok === true) return { etapa, estado: "concluida", em, motivo };
    if (ok === null) return { etapa, estado: "nao_observada", em: null, motivo };
    if (encerrada.falhou && !falhaMarcada) {
      falhaMarcada = true;
      return {
        etapa,
        estado: "falhou",
        em: null,
        motivo: (motivo ?? encerrada.motivo)?.slice(0, 160) ?? null,
      };
    }
    return { etapa, estado: "aguardando", em: null, motivo };
  });
}

function snapshot(entrada: Entrada): SnapshotWebrtc {
  return {
    estado: entrada.estado,
    stream: entrada.stream,
    espelhado: entrada.espelhado,
    diagnostico: { ...entrada.diagnostico },
  };
}

/* Só o que muda a tela: as estatísticas avançam a cada leitura, mas avisar os
   componentes a cada número novo fazia doze câmeras redesenharem por segundo.
   Aqui o aviso só sai quando algo visível muda de verdade. */
type Relevante = {
  estado: string;
  stream: MediaStream | null;
  espelhado: boolean;
  reanexos: number;
  temBytes: boolean;
  temQuadros: boolean;
  mensagemAgente: string | null;
  motivoFallback: string | null;
  motivoReconexao: string | null;
  answerAplicadoEm: string | null;
  sessionId: string | null;
  faseIce: FaseIce;
};

const ultimoPublicado = new WeakMap<Entrada, Relevante>();

function relevante(entrada: Entrada): Relevante {
  const d = entrada.diagnostico;
  return {
    estado: entrada.estado,
    stream: entrada.stream,
    espelhado: entrada.espelhado,
    reanexos: d.reanexos,
    temBytes: d.bytesReceived > 0,
    temQuadros: d.framesDecoded > 0,
    mensagemAgente: d.mensagemAgente,
    motivoFallback: d.motivoFallback,
    motivoReconexao: d.motivoReconexao,
    answerAplicadoEm: d.answerAplicadoEm,
    sessionId: d.sessionId,
    faseIce: d.faseIce,
  };
}

function igual(a: Relevante | undefined, b: Relevante) {
  if (!a) return false;
  return (
    a.estado === b.estado &&
    a.faseIce === b.faseIce &&
    a.stream === b.stream &&
    a.espelhado === b.espelhado &&
    a.reanexos === b.reanexos &&
    a.temBytes === b.temBytes &&
    a.temQuadros === b.temQuadros &&
    a.mensagemAgente === b.mensagemAgente &&
    a.motivoFallback === b.motivoFallback &&
    a.motivoReconexao === b.motivoReconexao &&
    a.answerAplicadoEm === b.answerAplicadoEm &&
    a.sessionId === b.sessionId
  );
}

function publicar(entrada: Entrada) {
  const agora = relevante(entrada);
  if (igual(ultimoPublicado.get(entrada), agora)) return;
  ultimoPublicado.set(entrada, agora);
  const atual = snapshot(entrada);
  for (const ouvinte of entrada.ouvintes) ouvinte(atual);
  if (typeof window !== "undefined") {
    const glob = window as unknown as {
      __webrtcConexoes?: Map<string, DiagnosticoConexaoWebrtc>;
    };
    glob.__webrtcConexoes ??= new Map();
    glob.__webrtcConexoes.set(entrada.chave, { ...entrada.diagnostico });
  }
}

/* Diagnóstico detalhado no console só quando pedido: ligar com
   `window.__webrtcDebug = true`. Imprimir o relatório inteiro a cada tentativa
   custava caro justamente durante as reconexões. */
function modoDiagnostico() {
  return typeof window !== "undefined" && (window as unknown as { __webrtcDebug?: boolean }).__webrtcDebug === true;
}

function registrar(nivel: "info" | "aviso" | "erro", texto: string, entrada: Entrada) {
  const resumo = `[webrtc] ${texto} · ${entrada.chave}`;
  const detalhe = modoDiagnostico() ? [{ ...entrada.diagnostico }] : [];
  if (nivel === "erro") console.error(resumo, ...detalhe);
  else if (nivel === "aviso") console.warn(resumo, ...detalhe);
  else if (modoDiagnostico()) console.info(resumo, ...detalhe);
}

/* A leitura de estatísticas é frequente enquanto a conexão se firma e passa a
   ser espaçada depois que a imagem está estável. */
function ajustarMonitor(entrada: Entrada, ms: number) {
  if (entrada.monitor && entrada.monitorMs === ms) return;
  if (entrada.monitor) clearInterval(entrada.monitor);
  entrada.monitorMs = ms;
  entrada.monitor = setInterval(() => {
    void lerEstatisticas(entrada)
      .then(() => {
        const estavel =
          entrada.estado === "ao-vivo" &&
          entrada.diagnostico.framesDecoded > 0 &&
          !entrada.bytesParadosDesde &&
          !entrada.desconectadoDesde;
        ajustarMonitor(entrada, estavel ? 4000 : 1000);
      })
      .catch((error) => {
        console.warn("[webrtc] falha ao ler estatísticas", entrada.chave, error);
      });
  }, ms);
}

function atualizarEstados(entrada: Entrada) {
  const pc = entrada.pc;
  if (!pc) return;
  entrada.diagnostico.signalingState = pc.signalingState;
  entrada.diagnostico.connectionState = pc.connectionState;
  entrada.diagnostico.iceConnectionState = pc.iceConnectionState;
}

async function entrarNaFila(prioridade = 0): Promise<() => void> {
  if (negociacoesAtivas >= MAX_NEGOCIACOES) {
    await new Promise<void>((resolve) => {
      filaNegociacao.push({ prioridade, resolve });
      filaNegociacao.sort((a, b) => a.prioridade - b.prioridade);
    });
  }
  negociacoesAtivas++;
  // ritmo combinado entre todas as janelas abertas: evita dezenas de pedidos
  // no mesmo instante quando várias telas abrem juntas
  await aguardarMarcha();
  let liberada = false;
  return () => {
    if (liberada) return;
    liberada = true;
    negociacoesAtivas--;
    filaNegociacao.shift()?.resolve();
  };
}

async function fechar(entrada: Entrada, notificarServidor: boolean) {
  entrada.cancelada = true;
  entrada.geracao += 1;
  entrada.abortController?.abort();
  entrada.abortController = null;
  if (entrada.renovacao) clearInterval(entrada.renovacao);
  if (entrada.monitor) clearInterval(entrada.monitor);
  if (entrada.encerramento) clearTimeout(entrada.encerramento);
  if (entrada.reconexao) clearTimeout(entrada.reconexao);
  entrada.renovacao = entrada.monitor = entrada.encerramento = entrada.reconexao = null;
  entrada.monitorMs = 0;
  try {
    entrada.pc?.close();
  } catch {
    // A conexão já estava fechada.
  }
  entrada.pc = null;
  entrada.stream = null;
  entrada.streamProprio = null;
  entrada.espelhado = false;
  entrada.pararEspelho?.();
  entrada.pararEspelho = null;
  removerFonte(entrada.chave);
  const sessionId = entrada.sessionId;
  entrada.sessionId = null;
  if (notificarServidor && sessionId) await encerrarWebrtc(sessionId).catch(() => undefined);
}

async function prepararReconexao(entrada: Entrada) {
  entrada.geracao += 1;
  entrada.abortController?.abort();
  entrada.abortController = null;
  if (entrada.renovacao) clearInterval(entrada.renovacao);
  if (entrada.monitor) clearInterval(entrada.monitor);
  entrada.renovacao = null;
  entrada.monitor = null;
  entrada.monitorMs = 0;
  const sessionId = entrada.sessionId;
  entrada.sessionId = null;
  try {
    entrada.pc?.close();
  } catch {
    // A conexão anterior já foi encerrada pelo navegador.
  }
  entrada.pc = null;
  entrada.streamProprio = null;
  // Esta câmera não tem mais imagem própria para repassar a outros usuários.
  removerFonte(entrada.chave);
  entrada.diagnostico.conexoesAtivas = 0;
  entrada.diagnostico.pedidosAtivos = 0;
  // O stream antigo é mantido: o <video> continua exibindo o último quadro
  // até a nova conexão entregar mídia.
  entrada.answerAplicado = false;
  entrada.bytesParadosDesde = null;
  entrada.ultimoAvancoBytes = 0;
  entrada.ultimosFrames = 0;
  entrada.desconectadoDesde = null;
  entrada.semDecodificarDesde = null;
  entrada.reanexoPedido = false;
  const anterior = entrada.diagnostico;
  entrada.diagnostico = diagnosticoNovo(entrada.chave);
  entrada.diagnostico.motivoReconexao = anterior.motivoReconexao;
  entrada.diagnostico.ultimoFrameEm = anterior.ultimoFrameEm;
  // Mesma ação do usuário (correlation_id), tentativa NOVA (tentativa_id novo).
  // Só T0–T2 pertencem à ação; T3–T8 da tentativa anterior vão para o
  // histórico e nunca aparecem como progresso desta tentativa.
  entrada.diagnostico.correlationId = anterior.correlationId;
  entrada.diagnostico.faseIce = entrada.faseIce;
  entrada.diagnostico.motivoFaseIce = entrada.motivoFaseIce;
  entrada.diagnostico.tentativaIce = anterior.tentativaIce + 1;
  entrada.hostLimiteT8 = null;
  entrada.primeiroQuadroLimite = null;
  const temposAcao: TemposVideo = {};
  for (const k of MARCOS_DA_ACAO) if (anterior.tempos[k] !== undefined) temposAcao[k] = anterior.tempos[k]!;
  entrada.diagnostico.tempos = temposAcao;
  entrada.diagnostico.historico = [
    ...anterior.historico,
    {
      tentativaId: anterior.tentativaId,
      sessionId: anterior.sessionId,
      tempos: anterior.tempos,
      iceConnectionState: anterior.iceConnectionState,
      bytesReceived: anterior.bytesReceived,
      framesDecoded: anterior.framesDecoded,
      motivo: anterior.motivoReconexao,
    },
  ].slice(-5);
  entrada.t8Enviado = false;
  entrada.diagnostico.congelamentos = anterior.congelamentos + 1;
  // Cada nova sessão precisa produzir seu próprio diagnóstico. Sem resetar
  // esta trava, somente a primeira falha chegava à telemetria e as tentativas
  // seguintes desapareciam justamente quando precisávamos localizar a queda.
  entrada.telemetriaEnviada = false;
  if (sessionId) await encerrarWebrtc(sessionId).catch(() => undefined);
}

/** Teto absoluto de recriações por ação do usuário (zera só com imagem confirmada). */
const MAX_TENTATIVAS_TOTAIS = 6;

// No máximo 4 recriações simultâneas: um mosaico inteiro nunca renegocia junto.
const MAX_RECRIACOES = 4;
let recriacoesAtivas = 0;
const filaRecriacao: Array<() => void> = [];

async function entrarNaFilaRecriacao(): Promise<() => void> {
  if (recriacoesAtivas >= MAX_RECRIACOES) {
    await new Promise<void>((resolve) => filaRecriacao.push(resolve));
  }
  recriacoesAtivas++;
  let liberada = false;
  return () => {
    if (liberada) return;
    liberada = true;
    recriacoesAtivas--;
    filaRecriacao.shift()?.();
  };
}

/**
 * Recria a sessão desta câmera apenas: conexão nova, oferta nova e session_id
 * novo. Nunca reaproveita o answer anterior. Uma recriação por câmera por vez.
 */
function reconectar(entrada: Entrada, motivo: string, opcoes?: { imediato?: boolean }) {
  if (entrada.cancelada || entrada.reconexao || entrada.recriando) return;
  // Uma rota ICE bloqueada (VPN/firewall/NAT) não melhora recriando a mesma
  // oferta indefinidamente. Depois de três sessões completas sem mídia, libera
  // o componente para usar HLS, que atravessa a mesma conexão HTTPS do painel.
  if (entrada.tentativasReconexao >= 3 || entrada.tentativasTotais >= MAX_TENTATIVAS_TOTAIS) {
    falhar(entrada, `${motivo}; usando entrega compatível pela web após 3 tentativas`);
    return;
  }
  entrada.recriando = true;
  atualizarEstados(entrada);
  entrada.estado = "instavel";
  entrada.diagnostico.motivoReconexao = motivo;
  enviarTelemetria(entrada, motivo);
  registrar("aviso", "recriando sessão", entrada);
  publicar(entrada);

  entrada.tentativasReconexao += 1;
  entrada.tentativasTotais += 1;
  // Espera progressiva: 1 s, 2 s, 4 s, 8 s e 15 s (+20% de jitter). Evita
  // tempestade de sessões quando o servidor local está congestionado.
  const ESPERAS = [1_000, 2_000, 4_000, 8_000, 15_000];
  const backoff = ESPERAS[Math.min(entrada.tentativasReconexao - 1, ESPERAS.length - 1)] ?? 15_000;
  // Troca para a fase ICE completa sai na hora (ainda respeitando Retry-After).
  const base = opcoes?.imediato ? 0 : backoff * (1 + Math.random() * 0.2);
  const espera = Math.max(base, entrada.esperaAte - Date.now());

  entrada.reconexao = setTimeout(() => {
    entrada.reconexao = null;
    void (async () => {
      const liberar = await entrarNaFilaRecriacao();
      try {
        await prepararReconexao(entrada);
        if (entrada.cancelada) return;
        // A limpeza terminou: libera a trava para que falhas DENTRO da nova
        // negociação (429, erro do Agent, troca de fase ICE) possam agendar a
        // próxima tentativa. A vaga da fila de recriação continua presa até o
        // fim de iniciar(); respostas antigas são descartadas pela geração.
        entrada.recriando = false;
        entrada.estado = "conectando";
        publicar(entrada);
        entrada.iniciando = iniciar(entrada);
        await entrada.iniciando;
      } finally {
        entrada.recriando = false;
        liberar();
      }
    })();
  }, espera);
}

/** Tentativa direta ainda aguardando provar mídia própria (T8). */
function diretoSemT8(entrada: Entrada): boolean {
  return entrada.faseIce === "direto" && entrada.diagnostico.tempos["T8"] === undefined;
}

/**
 * Encerra a tentativa direta (sem STUN/TURN) e faz UMA nova com configIce()
 * completa. Depois disso a mesma ação nunca volta ao modo direto.
 */
function irParaFaseCompleta(entrada: Entrada, motivo: string) {
  if (entrada.cancelada) return;
  if (entrada.faseIce !== "direto") {
    reconectar(entrada, motivo);
    return;
  }
  const curto = motivo.slice(0, 160);
  entrada.faseIce = "completa";
  entrada.motivoFaseIce = curto;
  entrada.hostLimiteT8 = null;
  entrada.primeiroQuadroLimite = null;
  registrar("aviso", `fase direta sem imagem; tentando STUN+TURN (${curto})`, entrada);
  reconectar(entrada, `direto sem STUN/TURN falhou: ${curto}; tentando STUN+TURN`, {
    imediato: true,
  });
}

/** Reconexão que, na fase direta sem T8, vira a troca para a fase completa. */
function recuperar(entrada: Entrada, motivo: string) {
  if (entrada.answerAplicado && diretoSemT8(entrada)) irParaFaseCompleta(entrada, motivo);
  else reconectar(entrada, motivo);
}

/**
 * Espera um candidato host no SDP local (ou coleta completa com candidato).
 * Não envia oferta vazia: devolve false se nada aparecer no prazo.
 */
function esperarCandidatoHost(pc: RTCPeerConnection, prazoMs: number, sinal: AbortSignal): Promise<boolean> {
  const temHost = () => /a=candidate:[^\r\n]* typ host/.test(pc.localDescription?.sdp ?? "");
  const temAlgum = () => /a=candidate:/.test(pc.localDescription?.sdp ?? "");
  return new Promise((resolve) => {
    let feito = false;
    const concluir = (ok: boolean) => {
      if (feito) return;
      feito = true;
      clearTimeout(timer);
      pc.removeEventListener("icecandidate", verificar);
      pc.removeEventListener("icegatheringstatechange", verificar);
      sinal.removeEventListener("abort", abortar);
      resolve(ok);
    };
    const verificar = () => {
      if (temHost()) concluir(true);
      else if (pc.iceGatheringState === "complete") concluir(temAlgum());
    };
    const abortar = () => concluir(false);
    const timer = setTimeout(() => concluir(temHost() || temAlgum()), prazoMs);
    pc.addEventListener("icecandidate", verificar);
    pc.addEventListener("icegatheringstatechange", verificar);
    sinal.addEventListener("abort", abortar);
    verificar();
  });
}

function falhar(entrada: Entrada, motivo: string) {
  if (entrada.cancelada || entrada.estado === "falha") return;
  atualizarEstados(entrada);
  entrada.estado = "falha";
  const errosIce = entrada.diagnostico.errosIce;
  entrada.diagnostico.motivoFallback = errosIce.length ? `${motivo} — falha na coleta TURN: ${errosIce[0]}` : motivo;
  enviarTelemetria(entrada, motivo);
  registrar("erro", "fallback para HLS", entrada);
  publicar(entrada);
  // Remove do cache: a entrada encerrada não pode ser reutilizada por quem
  // assinar depois — senão a câmera ficaria presa em "falha" para sempre.
  if (conexoes.get(entrada.chave) === entrada) conexoes.delete(entrada.chave);
  void fechar(entrada, true);
}

function mascararEndereco(endereco?: string): string {
  if (!endereco) return "?";
  if (endereco.includes(":")) return `${endereco.split(":").slice(0, 2).join(":")}:***`;
  const partes = endereco.split(".");
  return partes.length === 4 ? `${partes[0]}.${partes[1]}.*.*` : "***";
}

/** Endereço de rede local (RFC1918, CGNAT, link-local, loopback, IPv6 privado). */
function enderecoLocal(endereco?: string): boolean {
  if (!endereco) return false;
  const e = endereco.toLowerCase();
  if (e === "::1" || e.startsWith("fe80:") || e.startsWith("fc") || e.startsWith("fd")) return true;
  const p = e.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Classifica a rota pelo par de candidatos selecionado, nunca pelo IP anunciado. */
function classificarRota(
  tipoLocal: string | undefined,
  tipoRemoto: string | undefined,
  enderecoRemoto: string | undefined,
): RotaWebrtc {
  if (!tipoLocal && !tipoRemoto) return "UNKNOWN";
  if (tipoLocal === "relay" || tipoRemoto === "relay") return "TURN";
  if (!enderecoRemoto) return "DIRECT_UNKNOWN";
  return enderecoLocal(enderecoRemoto) ? "LAN" : "P2P";
}

/** Envia a telemetria sanitizada uma única vez por tentativa (T8 ou falha). */
function enviarTelemetria(entrada: Entrada, erro?: string) {
  if (entrada.telemetriaEnviada) return;
  entrada.telemetriaEnviada = true;
  const d = entrada.diagnostico;
  void enviarTelemetriaVideo({
    session_id: d.sessionId,
    correlation_id: d.correlationId,
    dvr_id: entrada.dvrId,
    canal: entrada.canal,
    qualidade: entrada.qualidade,
    rota: d.rota,
    tipo_candidato_local: d.tipoCandidatoLocal,
    tipo_candidato_remoto: d.tipoCandidatoRemoto,
    // tentativa_id e etapas vão junto dos tempos (jsonb) para não exigir
    // mudança de esquema; a futura tela "Caminho da imagem" lê daqui.
    tempos: {
      ...d.tempos,
      tentativa_id: d.tentativaId,
      confirmacao_quadro: d.confirmacaoQuadro,
      fase_ice: d.faseIce,
      motivo_fase_ice: d.motivoFaseIce,
      tentativa_ice: d.tentativaIce,
      caminho: caminhoDaImagem(d, { falhou: Boolean(erro), motivo: erro ?? null }),
    },
    tentativa_id: d.tentativaId,
    bytes_recebidos: d.bytesReceived,
    quadros_decodificados: d.framesDecoded,
    pacotes_recebidos: d.packetsReceived,
    connection_state: d.connectionState,
    ice_connection_state: d.iceConnectionState,
    signaling_state: d.signalingState,
    ultimo_quadro_em: d.ultimoFrameEm,
    motivo_reconexao: d.motivoReconexao,
    pedidos_ativos: d.pedidosAtivos,
    conexoes_ativas: d.conexoesAtivas,
    congelamentos: d.congelamentos,
    erro:
      [
        erro,
        `fase ICE: ${rotuloFaseIce(d.faseIce)} (tentativa ${d.tentativaIce})`,
        d.modoRelay ? "modo relay" : null,
        d.errosIce.length ? `ICE: ${d.errosIce.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join(" | ") || null,
  });
}

/** Tempo sem RTP/quadros (página visível) que caracteriza câmera interrompida. */
const SEM_MIDIA_MS = 8_000;

// Volta da rede: antecipa as recriações que ainda estavam esperando.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const entrada of conexoes.values()) {
      if (!entrada.reconexao) continue;
      clearTimeout(entrada.reconexao);
      entrada.reconexao = null;
      entrada.recriando = false;
      reconectar(entrada, "rede disponível novamente; antecipando a reconexão");
    }
  });
}

async function lerEstatisticas(entrada: Entrada) {
  const pc = entrada.pc;
  if (!pc || entrada.cancelada) return;
  atualizarEstados(entrada);
  const stats = await pc.getStats();
  stats.forEach((report) => {
    if (report.type === "inbound-rtp" && (report as { kind?: string }).kind === "video") {
      const video = report as unknown as {
        bytesReceived?: number;
        framesDecoded?: number;
        packetsReceived?: number;
        framesReceived?: number;
        keyFramesDecoded?: number;
        codecId?: string;
        decoderImplementation?: string;
      };
      const d = entrada.diagnostico;
      const codec = video.codecId
        ? (stats.get(video.codecId) as { mimeType?: string } | undefined)?.mimeType
        : undefined;
      if (codec) d.codec = codec + (video.decoderImplementation ? ` (${video.decoderImplementation})` : "");
      d.bytesReceived = video.bytesReceived ?? d.bytesReceived;
      d.framesDecoded = video.framesDecoded ?? d.framesDecoded;
      d.packetsReceived = video.packetsReceived ?? d.packetsReceived;
      d.framesReceived = video.framesReceived ?? d.framesReceived;
      d.keyFramesDecoded = video.keyFramesDecoded ?? d.keyFramesDecoded;
      return;
    }
    if (report.type === "candidate-pair") {
      const par = report as unknown as {
        state?: string;
        nominated?: boolean;
        selected?: boolean;
        localCandidateId?: string;
        remoteCandidateId?: string;
      };
      if (!(par.selected || (par.nominated && par.state === "succeeded"))) return;
      const local = par.localCandidateId
        ? (stats.get(par.localCandidateId) as unknown as
            | {
                candidateType?: string;
                address?: string;
              }
            | undefined)
        : undefined;
      const remoto = par.remoteCandidateId
        ? (stats.get(par.remoteCandidateId) as unknown as
            | {
                candidateType?: string;
                address?: string;
              }
            | undefined)
        : undefined;
      entrada.diagnostico.parIce =
        `${local?.candidateType ?? "?"}(${mascararEndereco(local?.address)})` +
        ` → ${remoto?.candidateType ?? "?"}(${mascararEndereco(remoto?.address)})`;
      entrada.diagnostico.tipoCandidatoLocal = local?.candidateType ?? null;
      entrada.diagnostico.tipoCandidatoRemoto = remoto?.candidateType ?? null;
      entrada.diagnostico.rota = classificarRota(local?.candidateType, remoto?.candidateType, remoto?.address);
    }
  });

  const agora = Date.now();
  const visivel = typeof document === "undefined" || !document.hidden;
  const avancouFrames = entrada.diagnostico.framesDecoded > entrada.ultimosFrames;
  if (avancouFrames) {
    entrada.ultimosFrames = entrada.diagnostico.framesDecoded;
    entrada.diagnostico.ultimoFrameEm = new Date(agora).toISOString();
    // A conexão própria já entrega imagem: desliga o espelho do outro usuário
    // e passa a repassar este vídeo para quem abrir a mesma câmera.
    if (entrada.espelhado || entrada.pararEspelho) {
      entrada.pararEspelho?.();
      entrada.pararEspelho = null;
      entrada.espelhado = false;
      if (entrada.streamProprio) entrada.stream = entrada.streamProprio;
      publicar(entrada);
    }
    if (entrada.stream) registrarFonte(entrada.chave, entrada.stream);
    // T7: primeiro quadro decodificado. Ainda NÃO comprova imagem na tela:
    // sucesso e telemetria só saem no T8 (confirmado no elemento de vídeo).
    marcar(entrada, "T7");
  }
  if (
    (pc.connectionState === "connected" || pc.iceConnectionState === "completed") &&
    entrada.diagnostico.tempos["T6"] === undefined
  ) {
    marcar(entrada, "T6");
  }

  const bytes = entrada.diagnostico.bytesReceived;
  if (bytes > entrada.ultimoAvancoBytes || avancouFrames) {
    entrada.ultimoAvancoBytes = Math.max(bytes, entrada.ultimoAvancoBytes);
    entrada.bytesParadosDesde = null;
    entrada.desconectadoDesde = null;
    // Bytes sem quadros não zeram o contador: evitava ciclo infinito.
    if (avancouFrames) {
      entrada.tentativasReconexao = 0;
      entrada.primeiroQuadroLimite = null;
    }
  } else if (entrada.answerAplicado && visivel) {
    entrada.bytesParadosDesde ??= agora;
  }

  // RTP chegando e nada decodificado: o problema está na anexação/decodificação
  // do player, não na origem. Primeiro reanexa o vídeo; só depois de insistir
  // por mais 8 s é que a sessão é recriada (uma única vez).
  const recebendoRtp = bytes > 0 || entrada.diagnostico.packetsReceived > 0;
  if (visivel && recebendoRtp && entrada.diagnostico.framesDecoded === 0) {
    entrada.semDecodificarDesde ??= agora;
    const paradoDecodificando = agora - entrada.semDecodificarDesde;
    if (!entrada.reanexoPedido && paradoDecodificando > 8_000) {
      entrada.reanexoPedido = true;
      entrada.diagnostico.reanexos += 1;
      registrar(
        "aviso",
        `RTP sem quadros decodificados: reanexando o vídeo [codec ${entrada.diagnostico.codec ?? "?"}, quadros recebidos ${entrada.diagnostico.framesReceived}, chave ${entrada.diagnostico.keyFramesDecoded}]`,
        entrada,
      );
      publicar(entrada);
    } else if (
      entrada.reanexoPedido &&
      paradoDecodificando > (entrada.qualidade === "principal" ? 45_000 : 16_000) &&
      entrada.hostLimiteT8 === null
    ) {
      reconectar(entrada, "RTP recebido sem quadros decodificados; sessão nova");
      return;
    }
  } else if (avancouFrames) {
    entrada.semDecodificarDesde = null;
    entrada.reanexoPedido = false;
  }

  // Aba oculta: o navegador pode pausar a decodificação. Nada é considerado
  // interrompido enquanto a página não está visível.
  if (!visivel) {
    // Segundo plano não consome o prazo da fase direta.
    if (entrada.hostLimiteT8 !== null) entrada.hostLimiteT8 = Math.max(entrada.hostLimiteT8, agora + prazoT8(entrada));
    entrada.bytesParadosDesde = null;
    entrada.desconectadoDesde = null;
    publicar(entrada);
    return;
  }

  // Já existe uma recriação pendente, ou a oferta atual ainda aguarda resposta:
  // nunca disparar outra oferta enquanto o estado for "have-local-offer".
  if (entrada.recriando || entrada.reconexao || pc.signalingState === "have-local-offer") {
    publicar(entrada);
    return;
  }

  if (pc.connectionState === "closed") {
    recuperar(entrada, "A conexão foi fechada pelo navegador");
    return;
  }

  if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
    recuperar(entrada, `ICE falhou antes da mídia (ice=${pc.iceConnectionState})`);
    return;
  }

  // Fase direta sem T8: só o prazo de 20 s após o answer (ou ICE failed acima)
  // decide a troca para STUN+TURN; as regras de 8/12/15 s não se aplicam aqui.
  if (entrada.hostLimiteT8 !== null && diretoSemT8(entrada)) {
    if (agora >= entrada.hostLimiteT8) {
      irParaFaseCompleta(entrada, `${prazoT8(entrada) / 1000} s após o answer sem primeiro quadro apresentado`);
      return;
    }
    publicar(entrada);
    return;
  }

  const desconectado = pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
  if (desconectado) entrada.desconectadoDesde ??= agora;
  else entrada.desconectadoDesde = null;

  const semRecuperacaoHa = entrada.desconectadoDesde ? agora - entrada.desconectadoDesde : 0;
  const semBytesHa = entrada.bytesParadosDesde ? agora - entrada.bytesParadosDesde : 0;
  const paradoHa = Math.max(semRecuperacaoHa, semBytesHa);

  if (
    entrada.primeiroQuadroLimite !== null &&
    agora >= entrada.primeiroQuadroLimite &&
    entrada.diagnostico.framesDecoded === 0
  ) {
    reconectar(
      entrada,
      entrada.diagnostico.bytesReceived > 0
        ? "12 s sem primeiro quadro decodificado; sessão nova"
        : "12 s sem receber o primeiro quadro; ICE sem mídia",
    );
    return;
  }

  // Oscilação curta não derruba nada: o último quadro fica na tela.
  if (paradoHa > 8_000 && entrada.estado === "ao-vivo") entrada.estado = "instavel";

  if (semRecuperacaoHa > 15_000) {
    reconectar(entrada, "15 s em disconnected sem recuperação; sessão nova");
    return;
  }
  if (semBytesHa > SEM_MIDIA_MS) {
    reconectar(entrada, "8 s sem novos bytes/quadros de vídeo; sessão nova");
    return;
  }
  publicar(entrada);
}

async function iniciar(entrada: Entrada) {
  if (entrada.diagnostico.pedidosAtivos > 0) return;
  const geracao = entrada.geracao;
  const abortController = new AbortController();
  entrada.abortController?.abort();
  entrada.abortController = abortController;
  entrada.diagnostico.pedidosAtivos = 1;
  // Imagem imediata: enquanto a conexão própria é negociada, pede a outro
  // navegador que já está vendo esta câmera para repassar o vídeo dele.
  if (!entrada.streamProprio && !entrada.pararEspelho) {
    entrada.pararEspelho = pedirEspelho(entrada.chave, (stream) => {
      if (entrada.cancelada || entrada.streamProprio) return;
      entrada.espelhado = true;
      entrada.stream = stream;
      publicar(entrada);
    });
  }
  // Câmera já publicando para outro espectador: o servidor local não precisa
  // abrir outra conexão no DVR, então esta solicitação não entra na fila e
  // sai na frente — é o caminho rápido que dá a sensação de imagem imediata.
  const quente = await cameraJaPublicando(entrada.dvrId, entrada.canal, entrada.qualidade);
  if (quente) entrada.prioridade = Math.min(entrada.prioridade, -2);
  // Principal (câmera ampliada pelo usuário) segue o fluxo do Diagnóstico
  // WebRTC: pedido imediato, sem fila de negociações nem espaçamento global —
  // senão ficava atrás das reconexões do mosaico e demorava a trocar.
  const direto = quente || entrada.qualidade === "principal";
  const liberar = direto ? () => {} : await entrarNaFila(entrada.prioridade);
  try {
    if (entrada.cancelada || entrada.pc) return;
    if (typeof RTCPeerConnection === "undefined") {
      falhar(entrada, "Este navegador não oferece suporte a WebRTC");
      return;
    }

    // Inclui TURN quando a infraestrutura oferece: sem isso a imagem só
    // atravessa dentro da mesma rede local.
    // Política em duas fases: primeiro direto (sem STUN/TURN, ICE continua
    // obrigatório); se falhar, uma tentativa com a configuração completa.
    // TURN forçado pelo operador pula a fase direta.
    const relay = modoRelayForcado();
    if (relay && entrada.faseIce !== "relay") {
      entrada.faseIce = "relay";
      entrada.motivoFaseIce = "TURN forçado pelo operador";
    }
    const fase = entrada.faseIce;
    let rtcConfig: RTCConfiguration;
    if (fase === "direto") {
      rtcConfig = { bundlePolicy: "max-bundle", iceServers: [] };
    } else {
      const baseIce = await configIce();
      if (entrada.cancelada || entrada.pc || entrada.geracao !== geracao) return;
      rtcConfig = fase === "relay" ? { ...baseIce, iceTransportPolicy: "relay" } : baseIce;
    }
    entrada.diagnostico.faseIce = fase;
    entrada.diagnostico.motivoFaseIce = entrada.motivoFaseIce ?? (fase === "direto" ? "tentativa inicial" : null);
    const pc = new RTCPeerConnection(rtcConfig);
    entrada.diagnostico.modoRelay = relay;
    entrada.diagnostico.errosIce = [];
    pc.onicecandidateerror = (ev) => {
      const e = ev as RTCPeerConnectionIceErrorEvent;
      const texto = `${e.errorCode} ${e.errorText || ""} (${urlIceSegura(e.url)})`.trim();
      const lista = entrada.diagnostico.errosIce;
      if (!lista.includes(texto) && lista.length < 5) lista.push(texto);
    };
    // Um único stream agrega as faixas que chegam em eventos separados. Alguns
    // Agents/MediaMTX entregam vídeo e áudio com msid diferentes; substituir o
    // stream a cada ontrack fazia o áudio, ao chegar por último, apagar o vídeo.
    const streamRecebido = new MediaStream();
    entrada.pc = pc;
    entrada.diagnostico.conexoesAtivas = 1;
    entrada.estado = "iniciando";
    // O MediaMTX recusa (HTTP 400) ofertas WHEP que não trazem as duas mídias
    // quando a publicação tem áudio: pedir vídeo e áudio evita a recusa.
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (evento) => {
      if (entrada.cancelada || entrada.pc !== pc) return;
      if (!streamRecebido.getTracks().some((track) => track.id === evento.track.id)) {
        streamRecebido.addTrack(evento.track);
      }
      // Atraso de reprodução igual em todas as câmeras: mantém o mosaico
      // no mesmo instante em vez de cada câmera escolher o próprio buffer.
      try {
        const receiver = evento.receiver as RTCRtpReceiver & { playoutDelayHint?: number };
        receiver.playoutDelayHint = 0.1;
      } catch {
        // Navegador sem suporte: segue com o atraso padrão.
      }
      entrada.streamProprio = streamRecebido;
      // Enquanto o espelho de outro usuário estiver na tela, ele continua
      // exibido: a troca acontece quando a imagem própria começa a decodificar.
      if (!entrada.espelhado) entrada.stream = streamRecebido;
      // A faixa pode chegar silenciada e só liberar mídia depois: ao sair do
      // mudo o player precisa reanexar e chamar play() de novo.
      evento.track.onunmute = () => {
        if (entrada.cancelada || entrada.pc !== pc) return;
        entrada.diagnostico.reanexos += 1;
        publicar(entrada);
      };
      publicar(entrada);
    };

    pc.onconnectionstatechange = () => {
      if (entrada.cancelada || entrada.pc !== pc) return;
      atualizarEstados(entrada);
      // "connected" confirma apenas o caminho ICE/DTLS. Não zera o limite
      // antes do primeiro quadro: há conexões que ficam connected sem receber
      // RTP e, nesse caso, zerar aqui provocava tentativas infinitas.
      // "disconnected" costuma durar 1-2 s e se recupera sozinho: o monitor
      // só marca instável depois de 8 s sem imagem, evitando o pisca-pisca.
      publicar(entrada);
    };
    pc.oniceconnectionstatechange = () => {
      if (entrada.cancelada || entrada.pc !== pc) return;
      atualizarEstados(entrada);
      // Fase direta: ICE failed antes da mídia troca na hora para STUN+TURN.
      if (pc.iceConnectionState === "failed" && entrada.answerAplicado && diretoSemT8(entrada)) {
        irParaFaseCompleta(entrada, "ICE falhou antes da mídia");
        return;
      }
      publicar(entrada);
    };

    // T3: início da negociação WebRTC neste navegador.
    marcar(entrada, "T3");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    entrada.diagnostico.ofertaCriadaEm = new Date().toISOString();
    if (fase === "direto") {
      const ok = await esperarCandidatoHost(pc, PRAZO_CANDIDATO_HOST_MS, abortController.signal);
      if (entrada.cancelada || entrada.pc !== pc || entrada.geracao !== geracao) return;
      if (!ok) {
        irParaFaseCompleta(
          entrada,
          `nenhum candidato host em ${PRAZO_CANDIDATO_HOST_MS / 1000} s (sem_candidato_host)`,
        );
        return;
      }
    } else {
      await esperarIce(pc);
    }
    if (entrada.cancelada || entrada.pc !== pc) return;
    const offerSdp = pc.localDescription?.sdp ?? offer.sdp;
    if (!offerSdp) {
      falhar(entrada, "A oferta SDP foi criada sem conteúdo");
      return;
    }

    const criada = await abrirWebrtc(
      entrada.dvrId,
      entrada.canal,
      offerSdp,
      entrada.qualidade,
      entrada.correlationId,
      abortController.signal,
    );
    if (entrada.cancelada || entrada.pc !== pc || entrada.geracao !== geracao) return;
    if (criada.tipo !== "ok") {
      if (criada.tipo === "negado") {
        falhar(entrada, `Sem permissão para abrir a câmera (HTTP ${criada.status})`);
      } else if (criada.tipo === "limite") {
        // 429: respeita o Retry-After antes de qualquer nova oferta.
        entrada.esperaAte = Date.now() + criada.retryAfterMs;
        reconectar(entrada, `muitas tentativas (HTTP 429); aguardando ${Math.round(criada.retryAfterMs / 1000)} s`);
      } else if (criada.tipo === "transitorio") {
        reconectar(entrada, `falha temporária ao criar a sessão (HTTP ${criada.status || "rede"})`);
      } else {
        falhar(entrada, `WebRTC indisponível: ${criada.motivo}`);
      }
      return;
    }
    entrada.sessionId = criada.session_id;
    entrada.diagnostico.sessionId = criada.session_id;
    // Agentes antigos não devolvem correlação: o id da sessão serve de âncora.
    entrada.diagnostico.correlationId = criada.correlation_id ?? entrada.correlationId ?? criada.session_id;
    entrada.estado = "negociando";
    publicar(entrada);

    const renovar = async () => {
      if (entrada.cancelada || !entrada.sessionId) return;
      await renovarWebrtc(entrada.sessionId, entrada.diagnostico.bytesReceived > 0);
    };
    await renovar();
    entrada.renovacao = setInterval(() => void renovar(), 20_000);

    // A oferta já foi entregue: liberar a vaga da fila permite que as outras
    // câmeras enviem as ofertas delas enquanto esta apenas aguarda a resposta.
    liberar();

    // O agente responde em lote e, com mosaicos grandes, a fila dele pode levar
    // vários minutos até chegar nas últimas câmeras. Medições recentes: mediana
    // ~5 min e 10% acima de 8 min. Esperar 15 min evita descartar um pedido que
    // o servidor local ainda vai responder (e recriar sessão só piora a fila).
    const ESPERA_ANSWER_MS = 900_000;
    const limite = Date.now() + ESPERA_ANSWER_MS;

    let answer: string | null = null;
    let entregue = false;
    // O servidor local às vezes fica preso em "negociando/aguardando_camera"
    // (publicação nunca fica pronta no MediaMTX) e nunca devolve o answer.
    // Reenviar a MESMA oferta a cada 60 s recoloca o pedido na fila dele sem
    // criar sessão nova nem abrir outra conexão RTSP.
    // Publicação quente: se o agente não responder rápido, insistir antes
    // (não há custo de abrir RTSP novo neste caso).
    const REENVIO_MS = quente ? 20_000 : 60_000;
    const MAX_REENVIOS = 5;
    let reenvios = 0;
    let proximoReenvio = Date.now() + REENVIO_MS;
    // Falhas transitórias (502/503/504/rede/abort) repetem o MESMO id em
    // 1 s, 2 s, 4 s e 8 s antes de descartar o id.
    const esperasTransitorias = [1_000, 2_000, 4_000, 8_000];
    let falhasSeguidas = 0;
    while (Date.now() < limite && !entrada.cancelada && entrada.pc === pc) {
      const resposta = await respostaWebrtc(criada.session_id, abortController.signal);
      if (entrada.cancelada || entrada.pc !== pc || entrada.geracao !== geracao) return;

      if (resposta.tipo === "negado") {
        falhar(entrada, `Sem autorização para acompanhar a sessão (HTTP ${resposta.status})`);
        return;
      }
      if (resposta.tipo === "ausente") {
        // O id não existe mais: criar uma sessão nova (conta no limite).
        reconectar(entrada, "a sessão não existe mais no servidor; criando outra");
        return;
      }
      if (resposta.tipo === "transitorio") {
        falhasSeguidas += 1;
        console.warn("[webrtc] falha transitória na consulta", {
          sessionId: criada.session_id,
          status: resposta.status,
          tentativa: falhasSeguidas,
        });
        if (falhasSeguidas > esperasTransitorias.length) {
          reconectar(entrada, `sinalização indisponível (HTTP ${resposta.status}) após 4 tentativas; sessão nova`);
          return;
        }
        await new Promise((r) => setTimeout(r, esperasTransitorias[falhasSeguidas - 1]));
        continue;
      }

      falhasSeguidas = 0;
      if (resposta.correlation_id) entrada.diagnostico.correlationId = resposta.correlation_id;
      if (resposta.marcos_agente) entrada.diagnostico.marcosAgente = resposta.marcos_agente;
      if (resposta.diagnostico_ice) entrada.diagnostico.diagnosticoIce = resposta.diagnostico_ice;
      if (resposta.marcos_agente?.source_ready === false) entrada.estado = "aguardando-fonte";
      if (resposta.entregue_em) {
        entregue = true;
        // T4: o servidor local retirou o pedido da fila.
        marcar(entrada, "T4");
      }
      if (resposta.answer_sdp) {
        answer = resposta.answer_sdp;
        entrada.diagnostico.answerRecebido = true;
        // T5: resposta SDP disponível para o navegador.
        marcar(entrada, "T5");
        break;
      }
      // Recusa pontual do servidor local (ex.: MediaMTX devolveu HTTP 400):
      // não desiste da câmera, tenta de novo com espera crescente.
      if (resposta.estado === "erro") {
        if (fase === "direto" && ERRO_ICE_RE.test(resposta.diagnostico ?? "")) {
          irParaFaseCompleta(entrada, `o agente recusou a negociação direta: ${resposta.diagnostico}`);
          return;
        }
        reconectar(entrada, resposta.diagnostico ?? "o agente informou erro na sessão WebRTC");
        return;
      }
      if (resposta.estado === "encerrada") {
        reconectar(entrada, resposta.diagnostico ?? "a sessão foi encerrada antes da resposta SDP");
        return;
      }
      // Mostra ao usuário o que o servidor local está fazendo em vez de um
      // "Negociando conexão" mudo.
      if (entrada.diagnostico.mensagemAgente !== (resposta.diagnostico ?? null)) {
        entrada.diagnostico.mensagemAgente = resposta.diagnostico ?? null;
        publicar(entrada);
      }
      if (Date.now() >= proximoReenvio && reenvios < MAX_REENVIOS) {
        reenvios += 1;
        proximoReenvio = Date.now() + REENVIO_MS;
        console.warn("[webrtc] reenviando oferta para a mesma sessão", {
          sessionId: criada.session_id,
          tentativa: reenvios,
          estado: resposta.estado,
          diagnostico: resposta.diagnostico,
        });
        await reofertarWebrtc(criada.session_id, offerSdp);
        if (entrada.cancelada || entrada.pc !== pc) return;
      }
      // Assinatura em tempo real da própria sessão: a resposta chega em
      // milissegundos. A consulta periódica continua como rede de segurança.
      await esperarSinalSessao(criada.session_id, 2_000);
    }
    if (entrada.cancelada || entrada.pc !== pc) return;
    if (!answer) {
      // Não desiste da câmera: tenta de novo com espera crescente. A mesma
      // linha de sessão é reaproveitada no servidor, então isso não cria
      // pedidos novos em cima do servidor local.
      reconectar(
        entrada,
        `${
          entregue
            ? "o servidor local recebeu o pedido, mas não devolveu a resposta SDP em 15 min"
            : "o servidor local ainda não buscou este pedido (15 min sem resposta SDP)"
        }${entrada.diagnostico.mensagemAgente ? ` · ${entrada.diagnostico.mensagemAgente}` : ""}`,
      );
      return;
    }

    entrada.estado = "conectando";
    publicar(entrada);
    try {
      if (entrada.geracao !== geracao || abortController.signal.aborted) return;
      if (pc.signalingState !== "have-local-offer") {
        reconectar(entrada, `resposta SDP antiga ignorada (estado ${pc.signalingState})`);
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      entrada.answerAplicado = true;
      entrada.diagnostico.answerAplicadoEm = new Date().toISOString();
      if (fase === "direto") {
        // Direto: 20 s após o answer para o T8 próprio (não espelho/HLS,
        // não apenas ICE connected ou bytes RTP).
        entrada.hostLimiteT8 = Date.now() + prazoT8(entrada);
        entrada.primeiroQuadroLimite = null;
      } else {
        entrada.primeiroQuadroLimite = Date.now() + 12_000;
      }
      registrar("info", "answer aplicado", entrada);
    } catch (error) {
      const completo = erroCompleto(error);
      entrada.diagnostico.erroSetRemoteDescription = completo;
      atualizarEstados(entrada);
      console.error("[webrtc] setRemoteDescription falhou", {
        ...entrada.diagnostico,
        error,
      });
      if (fase === "direto" && ERRO_ICE_RE.test(completo)) {
        irParaFaseCompleta(entrada, `resposta SDP incompatível com o modo direto: ${completo}`);
        return;
      }
      falhar(entrada, `Não foi possível aplicar a resposta SDP: ${completo}`);
      return;
    }

    ajustarMonitor(entrada, 1000);
  } catch (error) {
    if (abortController.signal.aborted || entrada.geracao !== geracao) return;
    falhar(entrada, `Falha durante a negociação WebRTC: ${erroCompleto(error)}`);
  } finally {
    if (entrada.geracao === geracao) {
      entrada.diagnostico.pedidosAtivos = 0;
      if (entrada.abortController === abortController) entrada.abortController = null;
    }
    liberar();
  }
}

function obterOuCriar(dvrId: string, canal: number, prioridade = 0, qualidade: QualidadeVideo = "extra"): Entrada {
  const chave = chaveDe(dvrId, canal, qualidade);
  const existente = conexoes.get(chave);
  // Só reutiliza conexões vivas; entradas canceladas/encerradas são descartadas.
  if (existente && !existente.cancelada && existente.estado !== "falha") {
    if (prioridade < existente.prioridade) existente.prioridade = prioridade;
    return existente;
  }
  if (existente) conexoes.delete(chave);
  const entrada: Entrada = {
    chave,
    dvrId,
    canal,
    qualidade,
    pc: null,
    streamProprio: null,
    espelhado: false,
    pararEspelho: null,
    stream: null,
    sessionId: null,
    estado: "iniciando",
    diagnostico: diagnosticoNovo(chave),
    ouvintes: new Set(),
    referencias: 0,
    iniciando: null,
    cancelada: false,
    answerAplicado: false,
    renovacao: null,
    monitor: null,
    monitorMs: 0,
    encerramento: null,
    ultimoAvancoBytes: 0,
    bytesParadosDesde: null,
    reconexao: null,
    tentativasReconexao: 0,
    ultimosFrames: 0,
    desconectadoDesde: null,
    semDecodificarDesde: null,
    reanexoPedido: false,
    recriando: false,
    prioridade,
    t0: Date.now(),
    correlationId: uuid(),
    telemetriaEnviada: false,
    t8Enviado: false,
    tentativasTotais: 0,
    esperaAte: 0,
    geracao: 0,
    abortController: null,
    primeiroQuadroLimite: null,
    faseIce: "direto",
    motivoFaseIce: null,
    hostLimiteT8: null,
  };
  entrada.diagnostico.correlationId = entrada.correlationId;
  // T0: o usuário abriu esta câmera.
  marcar(entrada, "T0");
  void registrarVisualizacao(dvrId, canal, qualidade);
  conexoes.set(chave, entrada);
  entrada.iniciando = iniciar(entrada);
  return entrada;
}

/**
 * Registra marcos observados pela interface: T1 (grade montada),
 * T2 (miniatura/cache exibida) e T8 (primeiro quadro visível na tela).
 */
export function marcarEventoVideo(
  dvrId: string,
  canal: number,
  evento: "T1" | "T2",
  qualidade: QualidadeVideo = "extra",
) {
  const entrada = conexoes.get(chaveDe(dvrId, canal, qualidade));
  if (!entrada || entrada.cancelada) return;
  marcar(entrada, evento);
}

/**
 * T8: primeiro quadro APRESENTADO, confirmado no elemento de vídeo
 * (requestVideoFrameCallback, ou fallback menos preciso). Só vale para a
 * conexão própria da tentativa atual — nunca para HLS nem para espelho.
 * Persistido uma única vez por tentativa.
 */
export function confirmarPrimeiroQuadro(
  dvrId: string,
  canal: number,
  qualidade: QualidadeVideo,
  video: HTMLVideoElement,
  metodo: "requestVideoFrameCallback" | "fallback_timeupdate",
) {
  const entrada = conexoes.get(chaveDe(dvrId, canal, qualidade));
  if (!entrada || entrada.cancelada || !entrada.pc || !entrada.answerAplicado) return;
  if (!entrada.streamProprio || video.srcObject !== entrada.streamProprio) return;
  if (video.videoWidth === 0) return;
  if (entrada.diagnostico.tempos["T8"] !== undefined) return;
  marcar(entrada, "T8");
  // T8 próprio: cancela o prazo da fase direta e segue nela normalmente.
  entrada.hostLimiteT8 = null;
  entrada.diagnostico.confirmacaoQuadro = metodo;
  entrada.estado = "ao-vivo";
  entrada.tentativasReconexao = 0;
  entrada.tentativasTotais = 0;
  publicar(entrada);
  if (entrada.t8Enviado) return;
  entrada.t8Enviado = true;
  void registrarSucesso(
    entrada.dvrId,
    entrada.canal,
    entrada.qualidade,
    entrada.diagnostico.tempos["T8"] ?? 0,
    entrada.diagnostico.rota,
  );
  enviarTelemetria(entrada);
}

export function assinarWebrtc(
  dvrId: string,
  canal: number,
  ouvinte: Ouvinte,
  opcoes?: { prioridade?: number; qualidade?: QualidadeVideo },
): () => void {
  const qualidade = opcoes?.qualidade ?? "extra";
  const prioridade = qualidade === "principal" ? -1 : (opcoes?.prioridade ?? 0);
  const entrada = obterOuCriar(dvrId, canal, prioridade, qualidade);
  if (entrada.encerramento) clearTimeout(entrada.encerramento);
  entrada.encerramento = null;
  entrada.referencias++;
  entrada.ouvintes.add(ouvinte);
  // Voltando para uma conexão guardada: se ela caiu enquanto ninguém olhava,
  // reconecta na hora em vez de esperar o watchdog.
  const pcGuardada = entrada.pc;
  if (
    entrada.referencias === 1 &&
    !entrada.cancelada &&
    pcGuardada &&
    (pcGuardada.connectionState === "failed" ||
      pcGuardada.connectionState === "closed" ||
      pcGuardada.iceConnectionState === "failed" ||
      pcGuardada.iceConnectionState === "disconnected")
  ) {
    entrada.tentativasReconexao = 0;
    recuperar(entrada, "a câmera voltou à tela com a conexão guardada perdida");
  }
  ouvinte(snapshot(entrada));

  let liberada = false;
  return () => {
    if (liberada) return;
    liberada = true;
    entrada.ouvintes.delete(ouvinte);
    entrada.referencias = Math.max(0, entrada.referencias - 1);
    if (entrada.referencias > 0) return;
    // A conexão continua viva por 5 minutos: trocas de etapa da ronda, tela
    // cheia, navegação entre telas e remontagens do StrictMode reaproveitam a
    // mesma sessão em vez de renegociar do zero. Enquanto outro usuário estiver
    // recebendo esta câmera por espelho, a conexão é mantida (até 30 minutos),
    // para que ele não perca a imagem quando eu troco de layout.
    const limite = Date.now() + ESPELHO_MAX_MS;
    const agendar = (ms: number) => {
      entrada.encerramento = setTimeout(() => {
        if (entrada.referencias > 0) return;
        if (fonteEmUso(entrada.chave) && Date.now() < limite) {
          agendar(ESPELHO_REVISAO_MS);
          return;
        }
        if (conexoes.get(entrada.chave) === entrada) conexoes.delete(entrada.chave);
        void fechar(entrada, true);
      }, ms);
    };
    // Principal: fica 1 minuto de reserva para reabrir a câmera na hora.
    agendar(entrada.qualidade === "principal" ? 60_000 : 300_000);
  };
}

export async function reiniciarWebrtc(
  dvrId: string,
  canal: number,
  qualidade: QualidadeVideo = "extra",
): Promise<void> {
  const chave = chaveDe(dvrId, canal, qualidade);
  const atual = conexoes.get(chave);
  if (atual) {
    conexoes.delete(chave);
    await fechar(atual, true);
  }
}
/**
 * Aba em segundo plano: o navegador congela os temporizadores da página, a
 * renovação da sessão (20 s) não acontece e a sessão expira no servidor
 * (45 s). Ao voltar para a tela, renovamos tudo na hora e, se a imagem não
 * voltar em poucos segundos, refazemos a conexão sozinhos — sem recarregar.
 */
function retomarConexoes() {
  if (typeof document === "undefined" || document.hidden) return;
  for (const entrada of Array.from(conexoes.values())) {
    if (entrada.cancelada || entrada.referencias === 0) continue;
    // Zera os relógios de "parado": o tempo em segundo plano não conta.
    entrada.bytesParadosDesde = null;
    entrada.desconectadoDesde = null;
    entrada.semDecodificarDesde = null;

    const pc = entrada.pc;
    if (
      pc &&
      (pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "disconnected")
    ) {
      entrada.tentativasReconexao = 0;
      recuperar(entrada, "a aba voltou do segundo plano com a conexão perdida");
      continue;
    }

    if (!entrada.sessionId || !entrada.answerAplicado) continue;
    const sessionId = entrada.sessionId;
    const framesAntes = entrada.diagnostico.framesDecoded;
    void renovarWebrtc(sessionId, entrada.diagnostico.bytesReceived > 0);
    setTimeout(() => {
      if (entrada.cancelada || entrada.referencias === 0) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (entrada.sessionId !== sessionId) return;
      if (entrada.diagnostico.framesDecoded > framesAntes) return;
      // Fase direta ainda dentro do prazo do T8: quem decide é esse prazo.
      if (entrada.hostLimiteT8 !== null && diretoSemT8(entrada)) return;
      entrada.tentativasReconexao = 0;
      reconectar(entrada, "a aba voltou do segundo plano sem imagem; refazendo a conexão");
    }, 5_000);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", retomarConexoes);
  window.addEventListener("focus", retomarConexoes);
  window.addEventListener("online", retomarConexoes);
}
