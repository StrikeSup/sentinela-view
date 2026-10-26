import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Play, Square, ShieldAlert } from "lucide-react";

import { dvrsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { ComboSelect } from "@/components/ComboSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { configIce, urlIceSegura } from "@/lib/ice";
import {
  abrirWebrtc,
  encerrarWebrtc,
  esperarIce,
  renovarWebrtc,
  respostaWebrtc,
  type MarcosAgente,
  type QualidadeVideo,
} from "@/lib/webrtc-sessions";

export const Route = createFileRoute("/_authenticated/diagnostico-webrtc")({
  head: () => ({
    meta: [
      { title: "Diagnóstico WebRTC — Sentinela VIEW" },
      {
        name: "description",
        content: "Teste isolado de uma câmera para descobrir por que a imagem fica preta.",
      },
      { property: "og:title", content: "Diagnóstico WebRTC — Sentinela VIEW" },
      {
        property: "og:description",
        content: "Linha do tempo, ICE e estatísticas de vídeo de uma câmera.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagnosticoWebrtc,
});

/* ---------------- tipos e utilitários ---------------- */

const ETAPAS = [
  ["oferta", "Oferta criada"],
  ["pedido", "Pedido aceito pela API"],
  ["agente", "Status do Agent observado no navegador"],
  ["rtsp", "RTSP pronto (source_ready)"],
  ["answer", "Answer recebido"],
  ["aplicado", "Answer aplicado"],
  ["ice", "ICE conectado"],
  ["rtp", "Bytes RTP de vídeo (getStats, amostrado)"],
  ["decod", "Quadros decodificados (getStats, amostrado)"],
  ["apresentado", "Primeiro quadro apresentado"],
] as const;
type Etapa = (typeof ETAPAS)[number][0];
/** Detectadas por getStats a cada 1 s: hora de detecção, não do evento real. */
const AMOSTRADAS: ReadonlySet<Etapa> = new Set<Etapa>(["rtp", "decod"]);

type Modo = "automatico" | "turn" | "rapido";
const NOME_MODO: Record<Modo, string> = {
  automatico: "Automático (prefere direto)",
  turn: "Forçar TURN (somente relay)",
  rapido: "Rápido direto (LAN/VPN, sem TURN)",
};
/** Durações locais medidas com performance.now (ms). */
type Tempos = Partial<
  Record<
    "config_ice" | "oferta_local" | "coleta_ice" | "post_api" | "espera_answer" | "ice_ate_midia",
    number
  >
>;
const NOME_TEMPO: Record<keyof Tempos, string> = {
  config_ice: "Configuração ICE",
  oferta_local: "createOffer + setLocalDescription",
  coleta_ice: "Coleta ICE",
  post_api: "POST API (ida e volta)",
  espera_answer: "Espera do Agent / answer",
  ice_ate_midia: "Answer aplicado → primeiro quadro",
};

const contarCandidatos = (sdp: string | undefined | null) =>
  (sdp?.match(/^a=candidate:/gm) ?? []).length;

/**
 * Coleta curta do modo rápido: ICE completo OU ~1,8 s com ao menos um
 * candidato no SDP. Sem candidato, espera até 5 s no total e então desiste
 * (nunca envia oferta vazia). Não altera o esperarIce da produção.
 */
async function coletaRapida(pc: RTCPeerConnection): Promise<boolean> {
  const t0 = performance.now();
  while (true) {
    const n = contarCandidatos(pc.localDescription?.sdp);
    if (pc.iceGatheringState === "complete") return n > 0;
    const dt = performance.now() - t0;
    if (dt >= 1800 && n > 0) return true;
    if (dt >= 5000) return false;
    await new Promise((res) => setTimeout(res, 100));
  }
}

const PRAZO_ANSWER_PADRAO_S = 120;
const LIMITE_MIDIA_MS = 20_000;

type Estados = {
  signaling: string;
  gathering: string;
  iceConn: string;
  conn: string;
};

type Stats = {
  bytesReceived?: number | undefined;
  packetsReceived?: number | undefined;
  framesReceived?: number | undefined;
  framesDecoded?: number | undefined;
  framesDropped?: number | undefined;
  keyFramesDecoded?: number | undefined;
  largura?: number | undefined;
  altura?: number | undefined;
  fps?: number | undefined;
  rttMs?: number | undefined;
  parBytesRecebidos?: number | undefined;
  parBytesEnviados?: number | undefined;
  localTipo?: string | undefined;
  remotoTipo?: string | undefined;
  remotoPrivado?: boolean | undefined;
  rota?: string | undefined;
};

type Log = { em: string; texto: string };

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function ipPrivado(ip: string): boolean {
  return (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|fc|fd|fe80)/i.test(ip) ||
    ip.endsWith(".local")
  );
}

/** Mascara IPs em qualquer texto (ex.: 192.168.1.20 -> 192.168.x.x). */
function sanitizar(t: string): string {
  return t
    .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.$2.x.x")
    .replace(/\b([0-9a-f]{1,4}):[0-9a-f:]{4,}\b/gi, "$1:…")
    .replace(/rtsp:\/\/\S+/gi, "rtsp://[oculto]")
    .replace(/(password|credential|token)=\S+/gi, "$1=[oculto]");
}

/** Texto livre para o relatório: sanitiza, corta SDP/segredos e limita tamanho. */
function limparTexto(t: string): string {
  const limpo = sanitizar(t)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@/gi, (m) => m.replace(/\/\/[^@]*@/, "//[oculto]@"))
    .replace(/(^|\s)(v=0|a=\S+|m=\S+|c=IN\s\S+)/g, "$1[sdp]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(
      /(senha|password|pass|pwd|secret|credential|token|username|user)\s*[:=]\s*\S+/gi,
      "$1=[oculto]",
    );
  return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
}

function rotaDe(local?: string, remoto?: string, remotoPrivado?: boolean): string | undefined {
  if (!local || !remoto) return undefined;
  if (local === "relay" || remoto === "relay") return "TURN (retransmissor)";
  if (local === "host" && remoto === "host")
    return remotoPrivado ? "Direto (host↔host) — LAN/VPN (endereço privado)" : "Direto (host↔host)";
  return "P2P via NAT (srflx/prflx)";
}

const hora = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("pt-BR", { hour12: false }) +
      "." +
      String(new Date(iso).getMilliseconds()).padStart(3, "0")
    : "—";
const fmt = (v: number | undefined, suf = "") =>
  v === undefined ? "não disponível" : `${v.toLocaleString("pt-BR")}${suf}`;

const NOME_TIMING: Record<string, string> = {
  auth_token: "Validação do login (token)",
  permissao: "Permissão",
  validacao: "Leitura e validação do pedido",
  db_consultas: "Banco: DVR, servidor, câmera, limite e sessão pendente",
  db_reuso: "Banco: reaproveitar sessão pendente",
  db_encerrar_anteriores: "Banco: encerrar sessões anteriores",
  db_insercao: "Banco: criar sessão",
  db_sessao: "Banco: ler sessão",
  db_servidor: "Banco: ler servidor (answer pronto)",
  total: "Total no servidor",
};

/* ---------------- componente ---------------- */

export function DiagnosticoWebrtc() {
  const { can, clienteIds } = useAuth();
  const [prazoS, setPrazoS] = useState(PRAZO_ANSWER_PADRAO_S);
  const { data: dvrs = [] } = useQuery(dvrsQuery);

  const [dvrId, setDvrId] = useState("");
  const [canal, setCanal] = useState(1);
  const [qualidade, setQualidade] = useState<QualidadeVideo>("extra");
  const [rodando, setRodando] = useState(false);
  const [modo, setModo] = useState<Modo>("automatico");
  const [tempos, setTempos] = useState<Tempos>({});
  const [timingPost, setTimingPost] = useState<Record<string, number> | null>(null);
  const [polls, setPolls] = useState<{
    n: number;
    total_ms: number;
    servidor_soma_ms: Record<string, number>;
    ultimo: Record<string, number> | null;
  } | null>(null);
  const temposRef = useRef<Tempos>({});
  const [temTurn, setTemTurn] = useState(false);
  const [marcos, setMarcos] = useState<Partial<Record<Etapa, string>>>({});
  const [inicio, setInicio] = useState<string>();
  const [estados, setEstados] = useState<Estados>({
    signaling: "—",
    gathering: "—",
    iceConn: "—",
    conn: "—",
  });
  const [stats, setStats] = useState<Stats>({});
  const [erros, setErros] = useState<Log[]>([]);
  const [eventos, setEventos] = useState<Log[]>([]);
  const [sessao, setSessao] = useState<{ id?: string; correlation?: string | null }>({});
  const [agente, setAgente] = useState<MarcosAgente | null>(null);
  const [falha, setFalha] = useState<{ codigo: string; texto: string } | null>(null);
  const [fallbackQuadro, setFallbackQuadro] = useState(false);
  const [diagServidor, setDiagServidor] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const limpeza = useRef<(() => void) | null>(null);
  const marcosRef = useRef<Partial<Record<Etapa, string>>>({});

  useEffect(() => {
    void configIce().then((c) =>
      setTemTurn(
        (c.iceServers ?? []).some((s) => [s.urls].flat().some((u) => /^turns?:/i.test(String(u)))),
      ),
    );
    return () => limpeza.current?.();
  }, []);

  // trocar de câmera encerra o teste em andamento
  useEffect(() => {
    limpeza.current?.();
  }, [dvrId, canal, qualidade]);

  const opcoes = useMemo(
    () =>
      (
        dvrs as Array<{
          id: string;
          nome: string;
          cliente_id?: string | null;
          clientes?: { nome: string } | null;
          servidores?: { nome: string } | null;
        }>
      )
        // mesmo recorte das outras telas: só DVRs dos clientes visíveis
        .filter((d) => clienteIds === null || (!!d.cliente_id && clienteIds.includes(d.cliente_id)))
        .map((d) => ({
          value: d.id,
          label: d.nome,
          hint: [d.clientes?.nome, d.servidores?.nome].filter(Boolean).join(" · "),
        })),
    [dvrs, clienteIds],
  );

  if (!can("diagnostico.ver")) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <ShieldAlert className="h-5 w-5" /> Você não tem permissão para esta ferramenta.
      </div>
    );
  }

  const marcar = (e: Etapa) => {
    if (marcosRef.current[e]) return;
    marcosRef.current = { ...marcosRef.current, [e]: new Date().toISOString() };
    setMarcos(marcosRef.current);
  };
  const medir = (k: keyof Tempos, ms: number) => {
    temposRef.current = { ...temposRef.current, [k]: Math.round(ms) };
    setTempos(temposRef.current);
  };
  const evento = (t: string) =>
    setEventos((l) => [...l, { em: new Date().toISOString(), texto: sanitizar(t) }].slice(-60));

  async function iniciar(modoTeste: Modo) {
    const forcarTurn = modoTeste === "turn";
    limpeza.current?.();
    if (!dvrId) return toast.error("Escolha um DVR");
    if (!Number.isInteger(canal) || canal < 1 || canal > 512)
      return toast.error("Canal deve ser de 1 a 512");

    marcosRef.current = {};
    setMarcos({});
    temposRef.current = {};
    setTempos({});
    setTimingPost(null);
    setPolls(null);
    setStats({});
    setErros([]);
    setEventos([]);
    setSessao({});
    setAgente(null);
    setFalha(null);
    setDiagServidor(null);
    setFallbackQuadro(false);
    setModo(modoTeste);
    setEstados({ signaling: "—", gathering: "—", iceConn: "—", conn: "—" });
    setInicio(new Date().toISOString());
    setRodando(true);

    let encerrado = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervalos: ReturnType<typeof setInterval>[] = [];
    const abort = new AbortController();
    let sessionId: string | undefined;
    let pc: RTCPeerConnection | null = null;
    const video = videoRef.current;
    const prazoAnswerMs = Math.min(900, Math.max(30, prazoS)) * 1000;
    const desfazer: Array<() => void> = [];
    /** Espera cancelável: resolve ao fim do tempo OU quando o teste para. */
    const esperar = (ms: number) =>
      new Promise<void>((res) => {
        if (abort.signal.aborted) return res();
        const t = setTimeout(() => {
          abort.signal.removeEventListener("abort", aoAbortar);
          res();
        }, ms);
        const aoAbortar = () => {
          clearTimeout(t);
          res();
        };
        abort.signal.addEventListener("abort", aoAbortar, { once: true });
      });

    const fim = (codigo: string | null, texto?: string) => {
      if (encerrado) return;
      if (codigo) setFalha({ codigo, texto: texto ?? codigo });
      evento(codigo ? `Fim: ${texto}` : "Teste encerrado");
      encerrado = true;
      abort.abort();
      timers.forEach(clearTimeout);
      intervalos.forEach(clearInterval);
      desfazer.forEach((f) => {
        try {
          f();
        } catch {
          /* ignora */
        }
      });
      try {
        pc?.getReceivers().forEach((r) => r.track?.stop());
        pc?.close();
      } catch {
        /* ignora */
      }
      if (video) video.srcObject = null;
      if (sessionId) void encerrarWebrtc(sessionId).catch(() => undefined);
      limpeza.current = null;
      setRodando(false);
    };
    limpeza.current = () => fim(null);

    try {
      let tp = performance.now();
      const bruto = await configIce();
      medir("config_ice", performance.now() - tp);
      // modo rápido: só STUN/host, nunca relay
      const base: RTCConfiguration =
        modoTeste === "rapido"
          ? {
              ...bruto,
              iceServers: (bruto.iceServers ?? [])
                .map((sv) => ({
                  urls: [sv.urls].flat().filter((u) => /^stun:/i.test(String(u))),
                }))
                .filter((sv) => sv.urls.length > 0),
            }
          : bruto;
      pc = new RTCPeerConnection(forcarTurn ? { ...base, iceTransportPolicy: "relay" } : base);
      evento(
        `ICE: ${
          (base.iceServers ?? [])
            .flatMap((s) => [s.urls].flat())
            .map((u) => urlIceSegura(String(u)))
            .join(", ") || "somente host"
        }${forcarTurn ? " (somente relay)" : ""}${modoTeste === "rapido" ? " (rápido, sem TURN)" : ""}`,
      );
      const atual = pc;
      const lerEstados = () =>
        setEstados({
          signaling: atual.signalingState,
          gathering: atual.iceGatheringState,
          iceConn: atual.iceConnectionState,
          conn: atual.connectionState,
        });
      atual.onsignalingstatechange = lerEstados;
      atual.onicegatheringstatechange = lerEstados;
      atual.oniceconnectionstatechange = () => {
        lerEstados();
        evento(`iceConnectionState: ${atual.iceConnectionState}`);
        if (["connected", "completed"].includes(atual.iceConnectionState)) marcar("ice");
        if (atual.iceConnectionState === "failed")
          fim(
            "ice_falhou",
            "ICE falhou: nenhum par de candidatos funcionou entre navegador e servidor.",
          );
      };
      atual.onconnectionstatechange = () => {
        lerEstados();
        if (atual.connectionState === "failed")
          fim("ice_falhou", "Conexão WebRTC falhou (DTLS/ICE).");
      };
      atual.onicecandidateerror = (ev) => {
        const e = ev as RTCPeerConnectionIceErrorEvent;
        setErros((l) =>
          [
            ...l,
            {
              em: new Date().toISOString(),
              texto: sanitizar(`${e.errorCode} ${e.errorText ?? ""} ${urlIceSegura(e.url)}`),
            },
          ].slice(-30),
        );
      };

      const stream = new MediaStream();
      atual.ontrack = (ev) => {
        if (!stream.getTracks().includes(ev.track)) stream.addTrack(ev.track);
        evento(`Track recebida: ${ev.track.kind}`);
        if (!video) return;
        video.muted = true;
        video.playsInline = true;
        if (video.srcObject !== stream) video.srcObject = stream;
        // o áudio pode chegar primeiro: ao entrar o vídeo, tenta tocar de novo
        if (ev.track.kind === "video" || video.paused) {
          video.play().catch((err: unknown) => {
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            setErros((l) => [
              ...l,
              { em: new Date().toISOString(), texto: `play() falhou — ${sanitizar(msg)}` },
            ]);
          });
        }
      };

      atual.addTransceiver("video", { direction: "recvonly" });
      atual.addTransceiver("audio", { direction: "recvonly" });
      lerEstados();

      tp = performance.now();
      const offer = await atual.createOffer();
      await atual.setLocalDescription(offer);
      medir("oferta_local", performance.now() - tp);
      tp = performance.now();
      if (modoTeste === "rapido") {
        const ok = await coletaRapida(atual);
        medir("coleta_ice", performance.now() - tp);
        if (encerrado) return;
        if (!ok)
          return fim(
            "sem_candidatos",
            "Modo rápido: nenhum candidato ICE (host/STUN) em 5 s; a oferta não foi enviada. Teste o modo Automático.",
          );
      } else {
        await esperarIce(atual);
        medir("coleta_ice", performance.now() - tp);
      }
      if (encerrado) return;
      marcar("oferta");
      const sdp = atual.localDescription?.sdp ?? offer.sdp;
      if (!sdp) return fim("answer_invalido", "A oferta local ficou sem conteúdo.");
      evento(`Oferta com ${contarCandidatos(sdp)} candidato(s) ICE`);

      tp = performance.now();
      const aberto = await abrirWebrtc(
        dvrId,
        canal,
        sdp,
        qualidade,
        crypto.randomUUID(),
        abort.signal,
      );
      medir("post_api", performance.now() - tp);
      setTimingPost(aberto.server_timing ?? null);
      if (encerrado) return;
      if (aberto.tipo === "negado")
        return fim(
          "api_autorizacao",
          `API negou o pedido (HTTP ${aberto.status}): sem login ou sem permissão.`,
        );
      if (aberto.tipo === "limite")
        return fim(
          "api_429",
          `Limite de pedidos (HTTP 429). Aguarde ${Math.round(aberto.retryAfterMs / 1000)} s antes de testar de novo.`,
        );
      if (aberto.tipo === "transitorio")
        return fim(
          "api_falha",
          `Falha da API ao criar a sessão (HTTP ${aberto.status || "rede"}).`,
        );
      if (aberto.tipo === "indisponivel")
        return fim("api_indisponivel", `Servidor sem vídeo direto: ${sanitizar(aberto.motivo)}`);
      sessionId = aberto.session_id;
      setSessao({ id: aberto.session_id, correlation: aberto.correlation_id });
      marcar("pedido");
      const sid = aberto.session_id;
      intervalos.push(setInterval(() => void renovarWebrtc(sid, !!marcosRef.current.rtp), 20_000));

      // acompanha a MESMA sessão até answer ou erro
      const tEspera = performance.now();
      const limite = Date.now() + prazoAnswerMs;
      let answer: string | null = null;
      let ultimoMarcos: MarcosAgente | null = null;
      const pollAcc = {
        n: 0,
        total_ms: 0,
        servidor_soma_ms: {} as Record<string, number>,
        ultimo: null as Record<string, number> | null,
      };
      while (!encerrado && Date.now() < limite) {
        const tPoll = performance.now();
        const r = await respostaWebrtc(sid, abort.signal);
        if (encerrado) return;
        pollAcc.n += 1;
        pollAcc.total_ms = Math.round(pollAcc.total_ms + (performance.now() - tPoll));
        if (r.tipo === "ok" && r.server_timing) {
          pollAcc.ultimo = r.server_timing;
          for (const [k, v] of Object.entries(r.server_timing))
            pollAcc.servidor_soma_ms[k] = Math.round((pollAcc.servidor_soma_ms[k] ?? 0) + v);
        }
        setPolls({ ...pollAcc, servidor_soma_ms: { ...pollAcc.servidor_soma_ms } });
        if (r.tipo === "negado")
          return fim("api_autorizacao", `Consulta da sessão negada (HTTP ${r.status}).`);
        if (r.tipo === "ausente")
          return fim("api_falha", "A sessão sumiu do servidor antes do answer.");
        if (r.tipo === "ok") {
          if (r.marcos_agente) {
            ultimoMarcos = r.marcos_agente;
            setAgente(r.marcos_agente);
            if (r.marcos_agente.solicitacao_recebida_em) marcar("agente");
            if (r.marcos_agente.source_ready || r.marcos_agente.publicacao_pronta_em)
              marcar("rtsp");
          }
          if (r.diagnostico) setDiagServidor(sanitizar(r.diagnostico));
          if (r.estado === "erro" || r.estado === "encerrada") {
            // só conclui "sem RTSP" com sinal explícito do Agent
            const semRtsp =
              ultimoMarcos?.source_ready === false ||
              (r.estado === "erro" && !!r.diagnostico && /rtsp|source|fonte/i.test(r.diagnostico));
            return fim(
              semRtsp ? "agent_sem_rtsp" : "answer_ausente",
              `Servidor encerrou a sessão (${r.estado})${r.diagnostico ? ": " + sanitizar(r.diagnostico) : ""}.`,
            );
          }
          if (r.answer_sdp) {
            answer = r.answer_sdp;
            break;
          }
        }
        const espera =
          r.tipo === "ok" && r.retry_after_ms
            ? Math.min(Math.max(r.retry_after_ms, 500), 3000)
            : 1000;
        await esperar(espera);
      }
      if (encerrado) return;
      if (!answer) {
        const semRtsp = ultimoMarcos?.source_ready === false;
        return fim(
          semRtsp ? "agent_sem_rtsp" : "prazo_ferramenta",
          semRtsp
            ? "O Agent informou source_ready=false: o RTSP da câmera não ficou pronto."
            : `Prazo da ferramenta (${prazoAnswerMs / 1000} s) esgotado sem answer. Isso não prova falha do RTSP — a fila real pode demorar mais; aumente o prazo e teste de novo.`,
        );
      }
      medir("espera_answer", performance.now() - tEspera);
      marcar("answer");
      if (!/^v=0/m.test(answer) || !/m=video/.test(answer))
        return fim("answer_invalido", "Answer recebido sem trecho de vídeo válido.");
      try {
        await atual.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        return fim(
          "answer_invalido",
          `Answer rejeitado pelo navegador: ${sanitizar(err instanceof Error ? err.message : String(err))}`,
        );
      }
      marcar("aplicado");
      const tAplicado = performance.now();
      const quadro = () => {
        if (encerrado || marcosRef.current.apresentado) return;
        medir("ice_ate_midia", performance.now() - tAplicado);
        marcar("apresentado");
      };
      void renovarWebrtc(sid, false);

      // primeiro quadro apresentado
      const v = video as
        | (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
            cancelVideoFrameCallback?: (id: number) => void;
          })
        | null;
      if (v?.requestVideoFrameCallback) {
        const idQuadro = v.requestVideoFrameCallback(() => {
          quadro();
        });
        desfazer.push(() => v.cancelVideoFrameCallback?.(idQuadro));
      } else if (v) {
        setFallbackQuadro(true);
        const verificar = () => {
          if (v.videoWidth > 0 && v.readyState >= 2) quadro();
        };
        v.addEventListener("playing", verificar, { once: true });
        v.addEventListener("resize", verificar);
        desfazer.push(() => {
          v.removeEventListener("playing", verificar);
          v.removeEventListener("resize", verificar);
        });
      }

      // stats a cada 1 s
      intervalos.push(
        setInterval(async () => {
          if (encerrado) return;
          let rep: RTCStatsReport;
          try {
            rep = await atual.getStats();
          } catch {
            return; // conexão fechada entre um ciclo e outro
          }
          if (encerrado) return;
          const s: Stats = {};
          const porId = new Map<string, Record<string, unknown>>();
          rep.forEach((x: Record<string, unknown>) => porId.set(String(x["id"]), x));
          let parId: string | undefined;
          rep.forEach((x: Record<string, unknown>) => {
            if (x["type"] === "inbound-rtp" && (x["kind"] ?? x["mediaType"]) === "video") {
              s.bytesReceived = num(x["bytesReceived"]);
              s.packetsReceived = num(x["packetsReceived"]);
              s.framesReceived = num(x["framesReceived"]);
              s.framesDecoded = num(x["framesDecoded"]);
              s.framesDropped = num(x["framesDropped"]);
              s.keyFramesDecoded = num(x["keyFramesDecoded"]);
              s.largura = num(x["frameWidth"]);
              s.altura = num(x["frameHeight"]);
              s.fps = num(x["framesPerSecond"]);
            }
            if (x["type"] === "transport" && typeof x["selectedCandidatePairId"] === "string")
              parId = x["selectedCandidatePairId"] as string;
          });
          if (!parId)
            rep.forEach((x: Record<string, unknown>) => {
              if (
                x["type"] === "candidate-pair" &&
                (x["selected"] === true || (x["nominated"] === true && x["state"] === "succeeded"))
              )
                parId = String(x["id"]);
            });
          const par = parId ? porId.get(parId) : undefined;
          if (par) {
            const rtt = num(par["currentRoundTripTime"]);
            s.rttMs = rtt === undefined ? undefined : Math.round(rtt * 1000);
            s.parBytesRecebidos = num(par["bytesReceived"]);
            s.parBytesEnviados = num(par["bytesSent"]);
            const loc = porId.get(String(par["localCandidateId"]));
            const rem = porId.get(String(par["remoteCandidateId"]));
            s.localTipo = loc ? String(loc["candidateType"] ?? "?") : undefined;
            s.remotoTipo = rem ? String(rem["candidateType"] ?? "?") : undefined;
            const ip = rem ? String(rem["address"] ?? rem["ip"] ?? "") : "";
            s.remotoPrivado = ip ? ipPrivado(ip) : undefined;
            s.rota = rotaDe(s.localTipo, s.remotoTipo, s.remotoPrivado);
          }
          if ((s.bytesReceived ?? 0) > 0) marcar("rtp");
          if ((s.framesDecoded ?? 0) > 0) marcar("decod");
          setStats(s);
        }, 1000),
      );

      timers.push(
        setTimeout(() => {
          const m = marcosRef.current;
          if (m.apresentado) return;
          if (!m.ice)
            fim("ice_falhou", `ICE não conectou em ${LIMITE_MIDIA_MS / 1000} s após o answer.`);
          else if (!m.rtp)
            fim(
              "ice_sem_rtp",
              "ICE conectado, mas nenhum byte RTP de vídeo chegou. Pode ser o servidor sem enviar mídia ou bloqueio/perda no caminho (firewall, NAT, retransmissor).",
            );
          else if (!m.decod)
            fim(
              "rtp_sem_decodificar",
              "RTP de vídeo chegou mas nenhum quadro foi decodificado (codec/keyframe).",
            );
          else
            fim(
              "decodificado_sem_render",
              "Quadros decodificados, mas nenhum foi apresentado no elemento de vídeo.",
            );
        }, LIMITE_MIDIA_MS),
      );
    } catch (err) {
      fim(
        "erro_local",
        `Erro no navegador: ${sanitizar(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  const sucesso = !!marcos.apresentado;
  const diagnostico = sucesso
    ? {
        codigo: "sucesso",
        texto: `Imagem apresentada no vídeo${fallbackQuadro ? " (detecção de quadro menos precisa neste navegador)" : ""}.`,
      }
    : falha;

  const relatorio = () => {
    const dvr = opcoes.find((o) => o.value === dvrId);
    return {
      ferramenta: "Sentinela VIEW — diagnóstico WebRTC",
      gerado_em: new Date().toISOString(),
      navegador: navigator.userAgent,
      dvr: { id: dvrId, nome: dvr?.label, cliente_servidor: dvr?.hint },
      canal,
      qualidade,
      modo: NOME_MODO[modo],
      aviso_modo:
        modo === "rapido"
          ? "Modo rápido não usa TURN: falha fora de LAN/VPN não prova indisponibilidade geral."
          : null,
      tempos_locais_ms: tempos,
      servidor_post_ms: timingPost,
      polling_resposta: polls,
      agente_tempo_resposta_ms:
        typeof agente?.tempo_resposta_ms === "number" ? agente.tempo_resposta_ms : null,
      observacao_servidor:
        "servidor_post_ms e polling_resposta.servidor_soma_ms vêm do cabeçalho Server-Timing (relógio do servidor, só durações). agente_tempo_resposta_ms é medido inteiramente no relógio do Agent (recebimento→answer) e não deve ser comparado com horários do navegador.",
      observacao_tempos:
        "tempos_locais_ms usam performance.now. Etapas rtp/decod vêm de getStats a cada 1 s (hora de detecção). 'agente' é a hora em que o navegador viu o status, não a hora de recebimento pelo Agent; essa está em marcos_agente.solicitacao_recebida_em (relógio do Agent).",
      prazo_answer_s: prazoS,
      rota_real: stats.rota ?? null,
      session_id: sessao.id ?? null,
      correlation_id: sessao.correlation ?? null,
      inicio,
      etapas: Object.fromEntries(
        ETAPAS.map(([k]) => [
          k,
          marcos[k]
            ? {
                em: marcos[k],
                amostrada: AMOSTRADAS.has(k),
                apos_ms: inicio
                  ? new Date(marcos[k]!).getTime() - new Date(inicio).getTime()
                  : null,
              }
            : null,
        ]),
      ),
      deteccao_quadro: fallbackQuadro ? "fallback (playing/resize)" : "requestVideoFrameCallback",
      estados,
      stats: {
        bytesReceived: stats.bytesReceived ?? null,
        packetsReceived: stats.packetsReceived ?? null,
        framesReceived: stats.framesReceived ?? null,
        framesDecoded: stats.framesDecoded ?? null,
        framesDropped: stats.framesDropped ?? null,
        keyFramesDecoded: stats.keyFramesDecoded ?? null,
        largura: stats.largura ?? null,
        altura: stats.altura ?? null,
        fps: stats.fps ?? null,
        rttMs: stats.rttMs ?? null,
        parBytesRecebidos: stats.parBytesRecebidos ?? null,
        parBytesEnviados: stats.parBytesEnviados ?? null,
        candidatoLocal: stats.localTipo ?? null,
        candidatoRemoto: stats.remotoTipo ?? null,
        remotoEmRedePrivada: stats.remotoPrivado ?? null,
      },
      // só campos de tempo/estado do Agent; nada de texto bruto
      marcos_agente: agente
        ? {
            solicitacao_recebida_em: agente.solicitacao_recebida_em ?? null,
            rtsp_iniciado_em: agente.rtsp_iniciado_em ?? null,
            publicacao_pronta_em: agente.publicacao_pronta_em ?? null,
            whep_iniciado_em: agente.whep_iniciado_em ?? null,
            answer_sdp_gerado_em: agente.answer_sdp_gerado_em ?? null,
            tempo_resposta_ms: agente.tempo_resposta_ms ?? null,
            tentativas: agente.tentativas ?? null,
            etapa: agente.etapa ? limparTexto(agente.etapa) : null,
            source_ready: agente.source_ready ?? null,
          }
        : null,
      diagnostico_servidor: diagServidor ? limparTexto(diagServidor) : null,
      erros_ice: erros.map((e) => ({ em: e.em, texto: limparTexto(e.texto) })),
      eventos: eventos.map((e) => ({ em: e.em, texto: limparTexto(e.texto) })),
      diagnostico_final: diagnostico,
    };
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(sanitizar(JSON.stringify(relatorio(), null, 2)));
      toast.success("Relatório copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  let anterior = inicio ? new Date(inicio).getTime() : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Diagnóstico WebRTC"
        description="Teste isolado de uma câmera, sem reconexão automática, HLS ou espelho."
      />

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[2fr_100px_120px_160px_auto]">
          <div className="space-y-1">
            <Label>DVR</Label>
            <ComboSelect
              value={dvrId}
              onChange={setDvrId}
              options={opcoes}
              placeholder="Escolha o DVR"
              searchPlaceholder="Buscar DVR, cliente…"
              disabled={rodando}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="diag-canal">Canal</Label>
            <Input
              id="diag-canal"
              type="number"
              min={1}
              max={512}
              value={canal}
              disabled={rodando}
              onChange={(e) => setCanal(Math.min(512, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="diag-prazo">Prazo do answer (s)</Label>
            <Input
              id="diag-prazo"
              type="number"
              min={30}
              max={900}
              value={prazoS}
              disabled={rodando}
              onChange={(e) =>
                setPrazoS(Math.min(900, Math.max(30, Number(e.target.value) || 120)))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="diag-q">Qualidade</Label>
            <select
              id="diag-q"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={qualidade}
              disabled={rodando}
              onChange={(e) => setQualidade(e.target.value as QualidadeVideo)}
            >
              <option value="extra">Extra (secundário)</option>
              <option value="principal">Principal</option>
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {rodando ? (
              <Button variant="destructive" onClick={() => limpeza.current?.()}>
                <Square className="mr-1 h-4 w-4" /> Parar
              </Button>
            ) : (
              <>
                <Button onClick={() => void iniciar("automatico")}>
                  <Play className="mr-1 h-4 w-4" /> Automático (prefere direto)
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void iniciar("rapido")}
                  title="Só host/STUN, sem TURN. Pode falhar fora de LAN/VPN; isso não prova indisponibilidade geral."
                >
                  Rápido direto (LAN/VPN, sem TURN)
                </Button>
                {temTurn && (
                  <Button variant="outline" onClick={() => void iniciar("turn")}>
                    Forçar TURN
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {diagnostico && (
        <Card className={sucesso ? "border-primary" : "border-destructive"}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <Badge variant={sucesso ? "default" : "destructive"}>{diagnostico.codigo}</Badge>
              <p className="mt-2 text-sm">{diagnostico.texto}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copiar()}>
              <Copy className="mr-1 h-4 w-4" /> Copiar relatório JSON
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vídeo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full rounded-md bg-muted object-contain"
            />
            <p className="text-xs text-muted-foreground">
              Sessão: {sessao.id ?? "—"} · Correlação: {sessao.correlation ?? "—"} · Modo:{" "}
              {NOME_MODO[modo]}
              {fallbackQuadro && " · Detecção de quadro por fallback (menos precisa)"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linha do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 text-sm">
              {ETAPAS.map(([k, nome]) => {
                const em = marcos[k];
                let dur = "";
                if (em) {
                  const t = new Date(em).getTime();
                  const desdeInicio = inicio ? t - new Date(inicio).getTime() : 0;
                  if (AMOSTRADAS.has(k)) {
                    // amostrada: sem delta entre eventos, pode vir fora de ordem
                    dur = `${desdeInicio} ms desde o início, amostrado`;
                  } else {
                    dur =
                      t >= anterior ? `+${t - anterior} ms` : `${desdeInicio} ms desde o início`;
                    anterior = Math.max(anterior, t);
                  }
                }
                return (
                  <li key={k} className="flex justify-between gap-2 border-b border-border/50 py-1">
                    <span className={em ? "" : "text-muted-foreground"}>
                      {em ? "✓" : "○"} {nome}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {em ? `${hora(em)} (${dur})` : "não observado"}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>
                "Status do Agent observado" é a hora em que o navegador viu a informação na
                consulta, não a hora real de recebimento pelo Agent. Bytes RTP e quadros
                decodificados vêm de amostras a cada 1 s e podem aparecer depois do primeiro quadro
                apresentado.
              </p>
              {agente?.solicitacao_recebida_em && (
                <p>
                  Recebimento pelo Agent (hora fornecida pelo Agent):{" "}
                  <span className="font-mono">{hora(agente.solicitacao_recebida_em)}</span> — a
                  diferença para a hora do navegador depende da sincronização dos relógios.
                </p>
              )}
              {modo === "rapido" && (
                <p>
                  Modo rápido não usa TURN: se falhar fora de LAN/VPN, isso não prova que a câmera
                  esteja indisponível.
                </p>
              )}
            </div>
            {timingPost && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium">
                  POST /api/video/webrtc — tempo no servidor (Server-Timing)
                </p>
                <ul className="space-y-0.5 text-xs">
                  {Object.entries(timingPost).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{NOME_TIMING[k] ?? k}</span>
                      <span className="font-mono">{Math.round(v)} ms</span>
                    </li>
                  ))}
                </ul>
                {tempos.post_api !== undefined && timingPost["total"] !== undefined && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Ida e volta no navegador: {tempos.post_api} ms · fora do servidor (rede, proxy,
                    fila): ~{Math.max(0, Math.round(tempos.post_api - timingPost["total"]))} ms
                  </p>
                )}
              </div>
            )}
            {polls && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium">Consultas da sessão (polling)</p>
                <ul className="space-y-0.5 text-xs">
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Consultas feitas</span>
                    <span className="font-mono">{polls.n}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      Tempo somado das consultas (navegador)
                    </span>
                    <span className="font-mono">{polls.total_ms} ms</span>
                  </li>
                  {Object.entries(polls.servidor_soma_ms).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        Servidor, soma: {NOME_TIMING[k] ?? k}
                      </span>
                      <span className="font-mono">{v} ms</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 text-xs">
              <p className="mb-1 font-medium">Agent: recebimento → answer (relógio do Agent)</p>
              <p className="font-mono">
                {typeof agente?.tempo_resposta_ms === "number"
                  ? `${agente.tempo_resposta_ms} ms`
                  : "não informado pelo Agent"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Medido só no relógio do Agent; não é comparado com os horários do navegador.
              </p>
            </div>
            {Object.keys(tempos).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium">Durações locais (performance.now)</p>
                <ul className="space-y-0.5 text-xs">
                  {(Object.keys(NOME_TEMPO) as Array<keyof Tempos>).map((k) =>
                    tempos[k] === undefined ? null : (
                      <li key={k} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{NOME_TEMPO[k]}</span>
                        <span className="font-mono">{tempos[k]} ms</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estados e rota ICE</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">signalingState</span>
            <span>{estados.signaling}</span>
            <span className="text-muted-foreground">iceGatheringState</span>
            <span>{estados.gathering}</span>
            <span className="text-muted-foreground">iceConnectionState</span>
            <span>{estados.iceConn}</span>
            <span className="text-muted-foreground">connectionState</span>
            <span>{estados.conn}</span>
            <span className="text-muted-foreground">Par selecionado</span>
            <span>
              {stats.localTipo ? `${stats.localTipo} → ${stats.remotoTipo}` : "não disponível"}
            </span>
            <span className="text-muted-foreground">Rota real (par selecionado)</span>
            <span>{stats.rota ?? "não disponível"}</span>
            <span className="text-muted-foreground">Remoto em rede privada</span>
            <span>
              {stats.remotoPrivado === undefined
                ? "não disponível"
                : stats.remotoPrivado
                  ? "sim"
                  : "não"}
            </span>
            <span className="text-muted-foreground">RTT</span>
            <span>{fmt(stats.rttMs, " ms")}</span>
            <span className="text-muted-foreground">Bytes do par (rec./env.)</span>
            <span>
              {fmt(stats.parBytesRecebidos)} / {fmt(stats.parBytesEnviados)}
            </span>
            {agente && (
              <>
                <span className="text-muted-foreground">Etapa do Agent</span>
                <span>{agente.etapa ?? "—"}</span>
                <span className="text-muted-foreground">source_ready</span>
                <span>
                  {agente.source_ready === undefined || agente.source_ready === null
                    ? "não informado"
                    : String(agente.source_ready)}
                </span>
              </>
            )}
            {diagServidor && (
              <>
                <span className="text-muted-foreground">Diagnóstico do servidor</span>
                <span className="break-words">{diagServidor}</span>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vídeo recebido (inbound-rtp)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">bytesReceived</span>
            <span>{fmt(stats.bytesReceived)}</span>
            <span className="text-muted-foreground">packetsReceived</span>
            <span>{fmt(stats.packetsReceived)}</span>
            <span className="text-muted-foreground">framesReceived</span>
            <span>{fmt(stats.framesReceived)}</span>
            <span className="text-muted-foreground">framesDecoded</span>
            <span>{fmt(stats.framesDecoded)}</span>
            <span className="text-muted-foreground">framesDropped</span>
            <span>{fmt(stats.framesDropped)}</span>
            <span className="text-muted-foreground">keyFramesDecoded</span>
            <span>{fmt(stats.keyFramesDecoded)}</span>
            <span className="text-muted-foreground">Resolução</span>
            <span>
              {stats.largura && stats.altura
                ? `${stats.largura}×${stats.altura}`
                : "não disponível"}
            </span>
            <span className="text-muted-foreground">framesPerSecond</span>
            <span>{fmt(stats.fps)}</span>
          </CardContent>
        </Card>
      </div>

      {(erros.length > 0 || eventos.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Erros e eventos</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 space-y-1 overflow-auto font-mono text-xs">
            {erros.map((e, i) => (
              <div key={`e${i}`} className="text-destructive">
                {hora(e.em)} {e.texto}
              </div>
            ))}
            {eventos.map((e, i) => (
              <div key={`v${i}`} className="text-muted-foreground">
                {hora(e.em)} {e.texto}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
