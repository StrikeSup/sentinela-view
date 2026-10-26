import { EVENTO_PRIMEIRO_QUADRO } from "@/lib/rotacao-deteccao";
import { aguardarQuadroApresentado } from "@/lib/quadro-apresentado";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCw } from "lucide-react";
import { usarModoDireto, marcarFalhaDireto } from "@/lib/app-desktop";
import { supabase } from "@/integrations/supabase/client";
import {
  abrirSessao,
  encerrarSessao,
  manterSessao,
  statusSessao,
  hlsValido,
  type EstadoSessao,
} from "@/lib/video-sessions";
import {
  assinarWebrtc,
  confirmarPrimeiroQuadro,
  marcarEventoVideo,
  reiniciarWebrtc,
  rotuloFaseIce,
  type SnapshotWebrtc,
} from "@/lib/webrtc-manager";
import type { QualidadeVideo } from "@/lib/webrtc-sessions";

/* ============================================================
 *  Player HLS estável — uma instância por câmera, reconexão
 *  automática sem destruir o player a cada heartbeat/render.
 * ============================================================ */

type Fase =
  | "carregando"
  | "negociando"
  | "aguardando-fonte"
  | "ao-vivo"
  | "instavel"
  | "reconectando"
  | "sem-video"
  | "indisponivel";

// O usuário vê apenas "Carregando" em qualquer etapa intermediária: termos
// como negociação ou reconexão passam a impressão de queda.
const MENSAGENS: Record<Fase, string> = {
  carregando: "Carregando",
  negociando: "Carregando",
  "aguardando-fonte": "Carregando",
  "ao-vivo": "Ao vivo",
  instavel: "Carregando",
  reconectando: "Carregando",
  "sem-video": "Sem imagem da câmera",
  indisponivel: "Servidor de imagens indisponível",
};

/* ---------- Resolução da URL HLS (com cache de 30 min) ---------- */

const BUFFER_MS = 30 * 60 * 1000;
const resolucoes = new Map<string, { url: string | null; expira: number }>();
const emAndamento = new Map<string, Promise<string | null>>();

async function hlsDireto(dvrId: string, canal: number): Promise<string | null> {
  const chave = `${dvrId}:${canal}`;
  const cache = resolucoes.get(chave);
  if (cache && cache.expira > Date.now()) return cache.url;
  const atual = emAndamento.get(chave);
  if (atual) return atual;

  const p = (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`/api/video/hls?dvr_id=${dvrId}&canal=${canal}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { url: string | null };
    const url = hlsValido(json.url);
    resolucoes.set(chave, { url, expira: Date.now() + BUFFER_MS });
    return url;
  })()
    .catch(() => null)
    .finally(() => emAndamento.delete(chave));

  emAndamento.set(chave, p);
  return p;
}

/* ---------- Fila: limita conexões simultâneas ---------- */

const MAX_SIMULTANEOS = 6;
let ativos = 0;
const fila: Array<() => void> = [];

async function entrarNaFila(): Promise<() => void> {
  if (ativos >= MAX_SIMULTANEOS) await new Promise<void>((r) => fila.push(r));
  ativos++;
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    ativos--;
    fila.shift()?.();
  };
}

/* ---------- Buffer de sessão (mantém ao sair da tela) ---------- */

type EntradaBuffer =
  | { tipo: "direto"; url: string; expira: number }
  | {
      tipo: "sessao";
      sessionId: string;
      whep: string | null;
      hls: string | null;
      expira: number;
      encerramento?: ReturnType<typeof setTimeout> | undefined;
    };

const buffer = new Map<string, EntradaBuffer>();
function chaveBuffer(dvrId: string, canal: number) {
  return `${dvrId}:${canal}`;
}

/* ============================================================
 *  Componente
 * ============================================================ */

/** Última imagem conhecida de cada câmera (memória do navegador). */
const PREVIAS = new Map<string, string>();
function guardarPrevia(chave: string, url: string) {
  const antiga = PREVIAS.get(chave);
  if (antiga && antiga !== url && antiga.startsWith("blob:")) URL.revokeObjectURL(antiga);
  PREVIAS.delete(chave);
  PREVIAS.set(chave, url);
  if (PREVIAS.size > 300) {
    const [k, v] = PREVIAS.entries().next().value as [string, string];
    if (v.startsWith("blob:")) URL.revokeObjectURL(v);
    PREVIAS.delete(k);
  }
}

export function CameraAoVivo({
  dvrId,
  canal,
  contido = false,
  segundoPlano = false,
  qualidade = "extra",
}: {
  dvrId: string;
  canal: number;
  contido?: boolean;
  /** "extra" = stream secundário (mosaico); "principal" = stream principal. */
  qualidade?: QualidadeVideo;
  /** Câmera pré-carregada fora da tela: negocia depois das visíveis. */
  segundoPlano?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /* Último quadro congelado: fica na frente do vídeo durante a troca de
     conexão para a imagem não piscar preto. */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [congelado, setCongelado] = useState(false);
  const liberacaoEmCurso = useRef(false);

  /* Guarda sempre o último quadro bom: se a troca acontecer depois que o
     vídeo já apagou, ainda existe uma imagem salva para sobrepor. */
  const temQuadroSalvo = useRef(false);

  /* O quadro guardado só serve para cobrir a troca de conexão por alguns
     instantes, então é salvo reduzido: copiar a imagem na resolução original
     de várias câmeas ao mesmo tempo é o que mais pesava na tela. */
  const LARGURA_QUADRO = 480;
  const salvarQuadro = useCallback(() => {
    const video = videoRef.current;
    const tela = canvasRef.current;
    if (!video || !tela || video.videoWidth === 0 || video.readyState < 2) {
      return false;
    }
    const escala = Math.min(1, LARGURA_QUADRO / video.videoWidth);
    const largura = Math.max(1, Math.round(video.videoWidth * escala));
    const altura = Math.max(1, Math.round(video.videoHeight * escala));
    if (tela.width !== largura) tela.width = largura;
    if (tela.height !== altura) tela.height = altura;
    const ctx = tela.getContext("2d", { alpha: false });
    if (!ctx) return false;
    try {
      ctx.drawImage(video, 0, 0, largura, altura);
    } catch {
      return false;
    }
    temQuadroSalvo.current = true;
    return true;
  }, []);

  const congelarQuadro = useCallback(() => {
    salvarQuadro();
    // Mesmo sem conseguir capturar agora, o último quadro salvo continua no
    // canvas e é ele que cobre a troca de conexão.
    if (temQuadroSalvo.current) {
      liberacaoEmCurso.current = false;
      setCongelado(true);
    }
  }, [salvarQuadro]);

  const liberarQuadroCongelado = useCallback(() => {
    const video = videoRef.current;
    if (!video || !temQuadroSalvo.current || liberacaoEmCurso.current) return;
    liberacaoEmCurso.current = true;
    const tempoInicial = video.currentTime;
    const fim = () => {
      liberacaoEmCurso.current = false;
      setCongelado(false);
    };
    const comQuadro = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }
    ).requestVideoFrameCallback?.bind(video);
    if (comQuadro) {
      // Só solta depois de dois quadros da nova conexão: o primeiro pode
      // chegar ainda sem conteúdo desenhado.
      comQuadro(() => {
        const atual = videoRef.current;
        if (!atual || atual.videoWidth === 0 || atual.currentTime <= tempoInicial) {
          liberacaoEmCurso.current = false;
          return;
        }
        comQuadro(() => {
          const segundo = videoRef.current;
          if (segundo && segundo.videoWidth > 0 && segundo.currentTime > tempoInicial) fim();
          else liberacaoEmCurso.current = false;
        });
      });
    } else {
      const aoAvancar = () => {
        if (video.videoWidth > 0 && video.currentTime > tempoInicial) fim();
        else liberacaoEmCurso.current = false;
      };
      video.addEventListener("timeupdate", aoAvancar, { once: true });
    }
  }, []);

  /* A câmera começa pedindo imagem imediatamente. Só solta a conexão quando
     ficar comprovadamente fora da área visível por bastante tempo — assim o
     mosaico não fica piscando/preto por causa de medições momentâneas. */
  const [naTela, setNaTela] = useState(true);
  useEffect(() => {
    const alvo = containerRef.current;
    if (!alvo || typeof IntersectionObserver === "undefined") {
      setNaTela(true);
      return;
    }
    let sair: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entradas) => {
        const visivel = entradas.some((e) => e.isIntersecting);
        if (visivel) {
          if (sair) {
            clearTimeout(sair);
            sair = null;
          }
          setNaTela(true);
        } else if (!sair) {
          // Tolerância longa: rolagens, trocas de layout e telas cheias não
          // devem derrubar uma conexão que já está entregando imagem.
          sair = setTimeout(() => setNaTela(false), 30_000);
        }
      },
      { threshold: 0, rootMargin: "300px" },
    );
    io.observe(alvo);
    return () => {
      if (sair) clearTimeout(sair);
      io.disconnect();
    };
  }, []);

  const [fase, setFase] = useState<Fase>("carregando");
  const [tentativa, setTentativa] = useState(0);
  const [urlHls, setUrlHls] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [hlsAusente, setHlsAusente] = useState(false);
  const [temImagem, setTemImagem] = useState(false);
  const [detalheWebrtc, setDetalheWebrtc] = useState<string | null>(null);
  const [faseIceTexto, setFaseIceTexto] = useState<string | null>(null);
  const [modoVideo, setModoVideo] = useState<"tentando-webrtc" | "webrtc" | "hls">(
    "tentando-webrtc",
  );
  /* Aplicativo Windows: vídeo sem conversão (H.264/H.265) direto por HLS. */
  const [direto, setDireto] = useState(false);
  useEffect(() => {
    const usar = usarModoDireto(`${dvrId}:${canal}`);
    setDireto(usar);
    if (usar) setModoVideo("hls");
  }, [dvrId, canal]);
  const sairDoDireto = useCallback(() => {
    marcarFalhaDireto(`${dvrId}:${canal}`);
    console.info(`[direto] sem quadros no modo direto; voltando ao WebRTC · ${dvrId}:${canal}`);
    setDireto(false);
    setUrlHls(null);
    setIndisponivel(false);
    setModoVideo("tentando-webrtc");
    setFase("carregando");
  }, [dvrId, canal]);
  useEffect(() => {
    if (!direto || !urlHls || temImagem) return;
    const t = setTimeout(sairDoDireto, 12_000);
    return () => clearTimeout(t);
  }, [direto, urlHls, temImagem, sairDoDireto]);
  /* Relógios do vigia de reprodução. Eles ficam aqui para também serem
     reiniciados quando a negociação entrega um novo answer SDP. */
  const paradoDesde = useRef<number | null>(null);
  const ultimoTempoVideo = useRef(-1);
  const reencaixeEm = useRef(0);
  const pedidoNovoEm = useRef(0);
  const answerAplicadoAtual = useRef<string | null>(null);

  /* Rede de segurança: de tempos em tempos um quadro é guardado, para existir
     uma imagem mesmo que a queda aconteça com o vídeo já apagado. Na hora da
     troca o quadro é capturado de novo, então esta cópia pode ser rara. */
  useEffect(() => {
    if (!temImagem || congelado) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      salvarQuadro();
    }, 3_000);
    salvarQuadro();
    return () => clearInterval(id);
  }, [temImagem, congelado, salvarQuadro]);

  /* Queda da câmera ou Agent fechando a conexão: a última imagem boa fica
     congelada por até 5 minutos em vez de tela preta. Assim que a imagem
     volta, o congelamento é solto pelo fluxo normal (liberarQuadroCongelado). */
  const CONGELAR_QUEDA_MS = 5 * 60 * 1000;
  const tinhaImagem = useRef(false);
  useEffect(() => {
    if (temImagem) {
      tinhaImagem.current = true;
      if (congelado) liberarQuadroCongelado();
      return;
    }
    if (!tinhaImagem.current || !temQuadroSalvo.current) return;
    // Usa o quadro já salvo: capturar agora poderia pegar o vídeo apagado.
    liberacaoEmCurso.current = false;
    setCongelado(true);
    const limite = setTimeout(() => {
      tinhaImagem.current = false;
      setCongelado(false);
    }, CONGELAR_QUEDA_MS);
    return () => clearTimeout(limite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temImagem]);

  /* Se a mesma célula passar a exibir outra câmera, limpa o quadro anterior
     imediatamente para não mostrar a imagem da câmera errada. */
  /* Ao ampliar a câmera, o stream principal costuma demorar para ser
     negociado. Enquanto ele não entrega imagem, continuamos exibindo o stream
     que já está no ar — a troca é feita só quando o novo estiver ao vivo. */
  const [qualidadeAtiva, setQualidadeAtiva] = useState<QualidadeVideo>(qualidade);
  useEffect(() => {
    if (!naTela) return;
    if (qualidade === qualidadeAtiva) return;
    let ativo = true;
    // Igual ao Diagnóstico WebRTC: a nova conexão é ligada a um vídeo próprio
    // assim que chega, para o primeiro quadro poder ser confirmado. Sem isso
    // ninguém exibia o stream novo, o T8 nunca vinha e a troca travava.
    const oculto = document.createElement("video");
    oculto.muted = true;
    oculto.autoplay = true;
    oculto.playsInline = true;
    oculto.setAttribute("aria-hidden", "true");
    oculto.style.cssText =
      "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(oculto);
    let pararAviso: (() => void) | null = null;
    const desassinar = assinarWebrtc(
      dvrId,
      canal,
      (snap) => {
        if (!ativo) return;
        const d = snap.diagnostico;
        if (snap.stream && !snap.espelhado && oculto.srcObject !== snap.stream) {
          oculto.srcObject = snap.stream;
          void oculto.play().catch(() => undefined);
          pararAviso?.();
          pararAviso = aguardarQuadroApresentado(oculto, () =>
            confirmarPrimeiroQuadro(dvrId, canal, qualidade, oculto, "requestVideoFrameCallback"),
          );
        }
        // Só troca o elemento visível depois do primeiro quadro apresentado.
        if (snap.estado === "ao-vivo" && d.tempos["T8"] !== undefined) {
          setQualidadeAtiva(qualidade);
        }
      },
      { prioridade: qualidade === "principal" ? -1 : 0, qualidade },
    );
    return () => {
      ativo = false;
      pararAviso?.();
      desassinar();
      oculto.srcObject = null;
      oculto.remove();
    };
  }, [dvrId, canal, qualidade, qualidadeAtiva, naTela]);

  // T1: o quadro desta câmera já está montado na grade.
  useEffect(() => {
    marcarEventoVideo(dvrId, canal, "T1", qualidadeAtiva);
  }, [dvrId, canal, qualidadeAtiva]);

  const cameraRef = useRef(`${dvrId}:${canal}`);
  useEffect(() => {
    const chave = `${dvrId}:${canal}`;
    if (cameraRef.current === chave) return;
    cameraRef.current = chave;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignora */
      }
    }
    const tela = canvasRef.current;
    tela?.getContext("2d")?.clearRect(0, 0, tela.width, tela.height);
    temQuadroSalvo.current = false;
    liberacaoEmCurso.current = false;
    setCongelado(false);
    setTemImagem(false);
    setUrlHls(null);
    setIndisponivel(false);
    setHlsAusente(false);
    setDetalheWebrtc(null);
    ultimoSnapshotWebrtc.current = null;
    setModoVideo("tentando-webrtc");
    setFase("carregando");
  }, [dvrId, canal]);

  const tentarDeNovo = useCallback(() => {
    congelarQuadro();
    void reiniciarWebrtc(dvrId, canal, qualidadeAtiva).finally(() => {
      setTentativa((n) => n + 1);
      setUrlHls(null);
      setIndisponivel(false);
      setHlsAusente(false);
      setDetalheWebrtc(null);
      setModoVideo("tentando-webrtc");
    });
  }, [dvrId, canal, qualidadeAtiva, congelarQuadro]);

  /* ---- Etapa 0: conexão WebRTC compartilhada por dvr_id:canal ---- */
  const semQuadroDesde = useRef<number | null>(null);
  const ultimoSnapshotWebrtc = useRef<SnapshotWebrtc | null>(null);
  useEffect(() => {
    if (!naTela || direto) return;
    let ativo = true;
    let streamAtual: MediaStream | null = null;
    let reanexosAplicados = 0;
    let espelhadoAtual: boolean | null = null;

    const temMidia = (snapshot: SnapshotWebrtc) => {
      const video = videoRef.current;
      const quadroReal = !!video && video.videoWidth > 0 && video.readyState >= 2;
      return (
        quadroReal &&
        // answer, ICE conectado, bytes RTP ou framesDecoded não bastam: só o
        // T8 confirmado no elemento de vídeo (ou espelho já validado).
        (snapshot.espelhado || snapshot.diagnostico.tempos["T8"] !== undefined)
      );
    };

    const aplicarSnapshot = (snapshot: SnapshotWebrtc) => {
      if (!ativo) return;
      ultimoSnapshotWebrtc.current = snapshot;
      {
        const d = snapshot.diagnostico;
        const texto = `ICE: ${rotuloFaseIce(d.faseIce)} · tentativa ${d.tentativaIce}${d.motivoFaseIce ? ` · ${d.motivoFaseIce}` : ""}`;
        setFaseIceTexto((atual) => (atual === texto ? atual : texto));
      }
      const answerAplicadoEm = snapshot.diagnostico.answerAplicadoEm;
      if (answerAplicadoEm && answerAplicadoAtual.current !== answerAplicadoEm) {
        answerAplicadoAtual.current = answerAplicadoEm;
        // A espera pelo Agent não conta como vídeo travado. O prazo para o
        // primeiro quadro começa somente depois que o answer foi aplicado.
        paradoDesde.current = Date.now();
        semQuadroDesde.current = Date.now();
      }
      const video = videoRef.current;
      const precisaReanexar = snapshot.diagnostico.reanexos > reanexosAplicados;
      // Sair do espelho de outro usuário para a conexão própria também é uma
      // troca, mesmo quando o objeto do vídeo parece o mesmo.
      const saiuDoEspelho = espelhadoAtual !== null && espelhadoAtual !== snapshot.espelhado;
      if (saiuDoEspelho && !snapshot.stream) congelarQuadro();
      espelhadoAtual = snapshot.espelhado;
      if (video && snapshot.stream && (streamAtual !== snapshot.stream || precisaReanexar)) {
        const trocandoDeFonte =
          (streamAtual !== null && streamAtual !== snapshot.stream) || saiuDoEspelho;
        // Troca suave: guarda o último quadro visível e mostra essa imagem
        // parada enquanto a nova conexão ainda não desenhou nada, evitando
        // o "pisca preto" no momento da troca.
        if (trocandoDeFonte) congelarQuadro();
        streamAtual = snapshot.stream;
        reanexosAplicados = snapshot.diagnostico.reanexos;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        if (video.srcObject !== snapshot.stream) video.srcObject = snapshot.stream;
        void video.play().catch(() => undefined);
        if (trocandoDeFonte) liberarQuadroCongelado();
      }

      if (snapshot.estado === "ao-vivo") {
        setDetalheWebrtc(null);
        setModoVideo("webrtc");
        // "connected" sem quadros decodificados produz tela preta: nesse caso
        // seguimos exibindo o aviso de carregamento em vez de dizer "Ao vivo".
        if (temMidia(snapshot)) {
          semQuadroDesde.current = null;
          setFase("ao-vivo");
          setTemImagem(true);
        } else {
          if (semQuadroDesde.current === null) semQuadroDesde.current = Date.now();
          setTemImagem(false);
          setFase(Date.now() - semQuadroDesde.current >= 25_000 ? "sem-video" : "carregando");
        }
        return;
      }
      // A imagem só é considerada ao vivo quando o elemento está realmente
      // reproduzindo um quadro e as estatísticas confirmam mídia recebida.
      if (temMidia(snapshot)) {
        semQuadroDesde.current = null;
        setDetalheWebrtc(null);
        setModoVideo("webrtc");
        setFase("ao-vivo");
        setTemImagem(true);
        return;
      }
      if (snapshot.estado === "falha") {
        congelarQuadro();
        // O gerenciador já registrou session_id, presença do answer, erro do
        // SDP, estados ICE/conexão e estatísticas antes deste fallback.
        setDetalheWebrtc(snapshot.diagnostico.motivoFallback);
        setModoVideo("hls");
        setFase("carregando");
        return;
      }
      if (snapshot.estado === "instavel") {
        congelarQuadro();
        setFase("reconectando");
        return;
      }
      if (snapshot.estado === "aguardando-fonte") {
        setDetalheWebrtc(snapshot.diagnostico.mensagemAgente);
        setFase("aguardando-fonte");
        return;
      }
      setDetalheWebrtc(snapshot.diagnostico.mensagemAgente);
      if (snapshot.diagnostico.answerAplicadoEm && snapshot.diagnostico.bytesReceived === 0) {
        setFase("instavel");
      } else {
        setFase(snapshot.estado === "iniciando" ? "carregando" : "negociando");
      }
    };

    const desassinar = assinarWebrtc(dvrId, canal, aplicarSnapshot, {
      prioridade: segundoPlano ? 1 : 0,
      qualidade: qualidadeAtiva,
    });
    return () => {
      ativo = false;
      semQuadroDesde.current = null;
      desassinar();
      // Não limpa srcObject aqui: a instância compartilhada absorve a
      // remontagem do StrictMode e mudanças visuais sem interromper a mídia.
    };
  }, [
    dvrId,
    canal,
    tentativa,
    segundoPlano,
    qualidadeAtiva,
    naTela,
    direto,
    congelarQuadro,
    liberarQuadroCongelado,
  ]);

  /* ---- Vigia de tela preta: conectado, mas sem imagem andando ----
   * Duas falhas produzem a tela preta que só voltava com Ctrl+Shift+R:
   *  1. o vídeo nunca desenha nenhum quadro (sem largura/altura);
   *  2. o vídeo está "conectado" mas a imagem congelou (o relógio do vídeo
   *     não avança), o que as estatísticas da conexão nem sempre acusam.
   * Em ambos os casos o player tenta sozinho: primeiro reencaixa a imagem
   * (limpa o vídeo no navegador e reencaixa a fonte), depois pede uma
   * solicitação nova da câmera ao servidor. */
  useEffect(() => {
    if (!naTela) return;
    const t = setInterval(() => {
      const video = videoRef.current;
      const comQuadro = !!video && video.videoWidth > 0 && video.readyState >= 2;
      const diagnostico = ultimoSnapshotWebrtc.current;
      // `currentTime` também pode avançar apenas pelo áudio. Só tratamos isso
      // como imagem em movimento quando o WebRTC confirmou quadro de vídeo
      // decodificado (ou quando a fonte é um espelho já validado).
      const videoConfirmado =
        modoVideo === "hls" ||
        diagnostico?.espelhado === true ||
        (diagnostico?.diagnostico.framesDecoded ?? 0) > 0;
      const agora = Date.now();
      const tempo = video?.currentTime ?? 0;
      const andando = comQuadro && videoConfirmado && tempo > ultimoTempoVideo.current;
      ultimoTempoVideo.current = tempo;

      if (andando) {
        semQuadroDesde.current = null;
        paradoDesde.current = null;
        setTemImagem(true);
        liberarQuadroCongelado();
        setFase((f) =>
          f === "sem-video" || f === "carregando" || f === "negociando" ? "ao-vivo" : f,
        );
        return;
      }

      if (!comQuadro) {
        setTemImagem(false);
        if (semQuadroDesde.current === null) semQuadroDesde.current = agora;
      }
      if (paradoDesde.current === null) paradoDesde.current = agora;
      const paradoHa = agora - paradoDesde.current;
      if (document.hidden) return;

      // 4 s parado: reencaixa a imagem no player (cache do vídeo no navegador).
      if (paradoHa >= 4_000 && agora - reencaixeEm.current > 8_000 && video) {
        reencaixeEm.current = agora;
        congelarQuadro();
        const fonte = video.srcObject;
        if (fonte) {
          video.srcObject = null;
          video.load();
          video.srcObject = fonte;
          video.muted = true;
          video.playsInline = true;
          void video.play().catch(() => undefined);
          liberarQuadroCongelado();
        }
        return;
      }

      // Nunca encerra uma sessão que ainda aguarda o answer do Agent. O
      // gerenciador controla esse prazo e reaproveita a mesma solicitação;
      // recriar aqui inundava a fila e fechava answers recém-entregues.
      // O gerenciador WebRTC já recria a sessão e limita as tentativas antes
      // de liberar o HLS. Reiniciar também por aqui zerava esse contador e
      // prendia a câmera para sempre em um ciclo de telas pretas.
      // Para HLS não existe answer; mantemos apenas sua recuperação própria.
      if (paradoHa >= 14_000 && modoVideo === "hls" && agora - pedidoNovoEm.current > 30_000) {
        pedidoNovoEm.current = agora;
        paradoDesde.current = agora;
        congelarQuadro();
        setFase((f) => (f === "indisponivel" ? f : "carregando"));
        void reiniciarWebrtc(dvrId, canal, qualidadeAtiva).finally(() => {
          setTentativa((n) => n + 1);
        });
        return;
      }

      // WebRTC "conectado" mas preto/parado há 30 s (o reencaixe não
      // resolveu): o gerenciador acha que está tudo bem, então pedimos uma
      // solicitação nova da câmera. Só quando a sessão já está ao vivo —
      // nunca enquanto aguarda o answer do Agent. Máx. 1 vez a cada 45 s.
      if (
        paradoHa >= 30_000 &&
        modoVideo !== "hls" &&
        diagnostico?.estado === "ao-vivo" &&
        agora - pedidoNovoEm.current > 45_000
      ) {
        pedidoNovoEm.current = agora;
        paradoDesde.current = agora;
        congelarQuadro();
        setFase((f) => (f === "indisponivel" ? f : "carregando"));
        console.info(`[webrtc] imagem parada/preta há 30 s; pedindo de novo · ${dvrId}:${canal}`);
        void reiniciarWebrtc(dvrId, canal, qualidadeAtiva).finally(() => {
          setTentativa((n) => n + 1);
        });
        return;
      }

      if (semQuadroDesde.current !== null && agora - semQuadroDesde.current >= 25_000) {
        setFase((f) => (f === "indisponivel" ? f : "sem-video"));
      }
    }, 2000);
    return () => clearInterval(t);
  }, [dvrId, canal, naTela, qualidadeAtiva, modoVideo, congelarQuadro, liberarQuadroCongelado]);

  /* ---- Etapa 1: resolver a URL HLS (direto ou via sessão) ---- */
  useEffect(() => {
    if (modoVideo !== "hls") return;
    let cancelado = false;
    let sessaoId: string | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let reagendar: ReturnType<typeof setTimeout> | null = null;
    let limite: ReturnType<typeof setTimeout> | null = null;
    let autoTentativas = 0;

    const chave = chaveBuffer(dvrId, canal);

    const limparSessao = () => {
      if (keepalive) clearInterval(keepalive);
      keepalive = null;
    };

    const resolver = async () => {
      if (cancelado) return;
      setFase("carregando");

      // Reutiliza buffer deixado ao sair da tela (não vale no modo direto)
      const emBuffer = direto ? undefined : buffer.get(chave);
      if (emBuffer && emBuffer.expira > Date.now()) {
        if (emBuffer.tipo === "sessao" && emBuffer.encerramento) {
          clearTimeout(emBuffer.encerramento);
          emBuffer.encerramento = undefined;
          sessaoId = emBuffer.sessionId;
          keepalive = setInterval(() => {
            if (sessaoId) void manterSessao(sessaoId);
          }, 20_000);
        }
        const url = emBuffer.tipo === "direto" ? emBuffer.url : (emBuffer.hls ?? emBuffer.whep);
        if (url) {
          if (!cancelado) setUrlHls(url);
          return;
        }
      }

      // Servidor local já publica em HTTPS/HLS
      const localHls = direto ? null : await hlsDireto(dvrId, canal);
      if (cancelado) return;
      if (localHls) {
        buffer.set(chave, { tipo: "direto", url: localHls, expira: Date.now() + BUFFER_MS });
        setUrlHls(localHls);
        return;
      }

      // Fallback: sessão sob demanda
      try {
        const criada = await abrirSessao(
          dvrId,
          canal,
          direto ? { entrega: "direto", qualidade: qualidadeAtiva } : undefined,
        );
        if (cancelado) return;
        sessaoId = criada.session_id;
        keepalive = setInterval(() => {
          if (sessaoId) void manterSessao(sessaoId);
        }, 20_000);

        let pronto: { whep: string | null; hls: string | null } | null = null;
        // Consulta rápida no início (o vídeo costuma ficar pronto em 1–3 s),
        // depois volta a 1 s; mantém o mesmo teto de ~60 s.
        const inicioEspera = Date.now();
        for (let i = 0; i < 120 && Date.now() - inicioEspera < 60_000; i++) {
          if (cancelado) return;
          const s = await statusSessao(sessaoId);
          if (s.estado === "publicando") {
            pronto = { whep: s.whep_url, hls: hlsValido(s.hls_url) };
            break;
          }
          if (s.estado === "erro")
            throw new Error(s.diagnostico ?? "Servidor local não enviou o vídeo");
          if (s.estado === "encerrada") {
            setIndisponivel(true);
            setFase("indisponivel");
            return;
          }
          await new Promise((r) => setTimeout(r, Date.now() - inicioEspera < 5000 ? 250 : 1000));
        }
        if (cancelado) return;
        if (!pronto || !pronto.hls) {
          if (direto) return sairDoDireto();
          setHlsAusente(true);
          setIndisponivel(true);
          setFase("indisponivel");
          return;
        }

        const url = pronto.hls;
        if (!direto)
          buffer.set(chave, {
            tipo: "sessao",
            sessionId: sessaoId!,
            whep: pronto.whep,
            hls: pronto.hls,
            expira: Date.now() + BUFFER_MS,
          });
        setUrlHls(url);
      } catch {
        if (cancelado) return;
        if (direto) return sairDoDireto();
        autoTentativas++;
        if (autoTentativas > 3) {
          setIndisponivel(true);
          setFase("indisponivel");
          return;
        }
        if (reagendar) clearTimeout(reagendar);
        reagendar = setTimeout(
          () => void resolver(),
          Math.min(3000 + autoTentativas * 2000, 20_000),
        );
      }
    };

    if (limite) clearTimeout(limite);
    limite = setTimeout(() => {
      if (!cancelado && !urlHls) {
        setIndisponivel(true);
        setFase("indisponivel");
      }
    }, 45_000);

    void resolver();

    return () => {
      cancelado = true;
      if (reagendar) clearTimeout(reagendar);
      if (limite) clearTimeout(limite);
      limparSessao();
      const entrada = buffer.get(chave);
      if (sessaoId && entrada?.tipo === "sessao") {
        const id = sessaoId;
        entrada.expira = Date.now() + BUFFER_MS;
        entrada.encerramento = setTimeout(() => {
          buffer.delete(chave);
          void encerrarSessao(id);
        }, BUFFER_MS);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvrId, canal, tentativa, modoVideo, direto, direto ? qualidadeAtiva : null]);

  /* ---- Etapa 2: player HLS — depende SOMENTE da URL ---- */
  useEffect(() => {
    if (!urlHls) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelado = false;
    let hls: import("hls.js").default | null = null;
    let reconectando = false;
    let reconexaoTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let tentativasReconexao = 0;
    let falhasRedeSeguidas = 0;
    let mediaRecoveryCount = 0;
    let ultimoTempo = video.currentTime;
    let ultimoAvanco = Date.now();
    let stallStartTime: number | null = null;
    let frameChegou = false;
    let ultimaCorrecaoAtraso = 0;

    const setFaseSafe = (f: Fase) => {
      if (!cancelado) setFase(f);
    };

    /* --- Reconstrução completa (último recurso) --- */
    const reconstruir = () => {
      if (cancelado || reconectando) return;
      reconectando = true;
      congelarQuadro();

      // 1. Impede duas reconexões simultâneas
      // 2. Destroi a instância antiga
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* ignora */
        }
        hls = null;
      }
      // 3. Remove src e executa load()
      video.removeAttribute("src");
      video.srcObject = null;
      try {
        video.load();
      } catch {
        /* ignora */
      }

      tentativasReconexao++;
      const n = tentativasReconexao;
      if (n >= 5) {
        const chave = chaveBuffer(dvrId, canal);
        resolucoes.delete(chave);
        buffer.delete(chave);
      }
      // 4. Backoff: 1, 2, 4, 8, 15s + variação aleatória até 500ms
      const base = Math.min(Math.pow(2, Math.min(n - 1, 4)), 15);
      const jitter = Math.random() * 500;
      const espera = base * 1000 + jitter;

      setFaseSafe("reconectando");

      if (reconexaoTimer) clearTimeout(reconexaoTimer);
      reconexaoTimer = setTimeout(() => {
        reconectando = false;
        if (!cancelado) iniciarPlayer();
      }, espera);
    };

    /* --- Recuperação interna (antes de reconstruir) --- */
    const requestRecovery = (tipo: string) => {
      if (cancelado) return;
      if (tipo === "network") {
        falhasRedeSeguidas++;
        if (falhasRedeSeguidas <= 3) {
          // Falhas de rede seguidas: retoma o carregamento sem derrubar o player
          try {
            hls?.startLoad(-1);
          } catch {
            /* ignora */
          }
          return;
        }
        // Persistiu: reconstrução completa
        reconstruir();
        return;
      }

      if (tipo === "media") {
        reconstruir();
        return;
      }
      // fatal genérico
      reconstruir();
    };

    /* --- Inicializa o player (HLS.js ou nativo Safari) --- */
    const iniciarPlayer = async () => {
      if (cancelado) return;
      const liberar = await entrarNaFila();
      try {
        if (cancelado) return;

        // Safari nativo
        if (video.canPlayType("application/vnd.apple.mpegurl") && !window.MediaSource) {
          setFaseSafe("carregando");
          const aoErro = () => {
            if (!cancelado) reconstruir();
          };
          const aoStalled = () => {
            /* watchdog cuida */
          };
          video.addEventListener("error", aoErro);
          video.addEventListener("stalled", aoStalled);
          video.src = urlHls;
          await video.play().catch(() => {});
          // Watchdog nativo
          iniciarWatchdog(() => {
            try {
              video.load();
              video.play().catch(() => {});
            } catch {
              /* ignora */
            }
          }, reconstruir);
          return;
        }

        // HLS.js
        const HlsMod = await import("hls.js");
        const Hls = HlsMod.default;
        if (!Hls.isSupported()) {
          setFaseSafe("sem-video");
          return;
        }

        // Destrói instância anterior se existir
        if (hls) {
          try {
            hls.destroy();
          } catch {
            /* ignora */
          }
          hls = null;
        }

        const instancia = new Hls({
          lowLatencyMode: false,
          enableWorker: true,
          startLevel: -1,
          // A lista ao vivo do servidor tem ~20 s: buffer curto e folga de 3 segmentos
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          maxLiveSyncPlaybackRate: 1.05,
          maxBufferLength: 12,
          maxMaxBufferLength: 24,
          backBufferLength: 10,
          // Evita estourar a memória quando há muitas câmeras no mosaico
          maxBufferSize: 20 * 1000 * 1000,
          nudgeMaxRetry: 10,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 15000,
          levelLoadingMaxRetry: 8,
          levelLoadingRetryDelay: 1000,
          levelLoadingMaxRetryTimeout: 15000,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: 20000,
          // O servidor de vídeo responde 302 com cookie em toda requisição sem
          // "cookieCheck". Como o cookie é de outro domínio, ele nunca é aceito
          // pelo navegador e cada pedido vira um redirecionamento novo, o que
          // derruba a sessão do vídeo. Enviar o parâmetro evita esse desvio.
          xhrSetup: (xhr: XMLHttpRequest, url: string) => {
            if (url.includes("cookieCheck=")) return;
            const separador = url.includes("?") ? "&" : "?";
            xhr.open("GET", `${url}${separador}cookieCheck=1`, true);
          },
        });

        hls = instancia;

        instancia.loadSource(urlHls);
        instancia.attachMedia(video);

        instancia.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelado) return;
          video.play().catch(() => {});
        });

        instancia.on(Hls.Events.FRAG_BUFFERED, () => {
          if (cancelado) return;
          frameChegou = true;
          setTemImagem(true);
          falhasRedeSeguidas = 0;
          // Zera contador só depois de 5s de avanço
          // (verificado no watchdog)
        });

        instancia.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelado) return;
          if (!data.fatal) {
            // Erro momentâneo: o hls.js já refaz sozinho, não muda o estado na tela
            return;
          }

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            requestRecovery("network");
            return;
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              instancia.recoverMediaError();
              mediaRecoveryCount++;
              if (mediaRecoveryCount > 2) {
                requestRecovery("media");
              }
            } catch {
              requestRecovery("media");
            }
            return;
          }

          requestRecovery("fatal");
        });

        // Watchdog para HLS.js
        iniciarWatchdog(() => {
          try {
            instancia.startLoad(-1);
            video.play().catch(() => {});
          } catch {
            /* ignora */
          }
        }, reconstruir);
      } finally {
        liberar();
      }
    };

    /* --- Watchdog: a cada 2s verifica se o tempo avança --- */
    const iniciarWatchdog = (onStallFirst: () => void, onStallRebuild: () => void) => {
      if (watchdog) clearInterval(watchdog);
      ultimoTempo = video.currentTime;
      ultimoAvanco = Date.now();
      stallStartTime = null;
      let primeiraTentativaFeita = false;
      let cincoSegAvancando = 0;

      watchdog = setInterval(() => {
        if (cancelado) return;

        if (Date.now() - ultimaCorrecaoAtraso >= 10_000) {
          ultimaCorrecaoAtraso = Date.now();
          corrigirAtraso();
        }

        const advanced = video.currentTime > ultimoTempo + 0.05;
        if (advanced) {
          ultimoTempo = video.currentTime;
          ultimoAvanco = Date.now();
          stallStartTime = null;
          primeiraTentativaFeita = false;
          cincoSegAvancando++;
          // Zera contador após 5s de avanço contínuo (2.5s * 2 = ~5s)
          if (cincoSegAvancando >= 2) {
            tentativasReconexao = 0;
            frameChegou = true;
            if (fase !== "ao-vivo") setFaseSafe("ao-vivo");
          }
          return;
        }

        // Não avançou
        cincoSegAvancando = 0;
        const stalledForMs = Date.now() - ultimoAvanco;

        // Só considera travado quando deveria estar tocando e sem avanço por 15s
        if (!document.hidden && !video.paused && stalledForMs >= 15_000) {
          if (!primeiraTentativaFeita) {
            // Primeira tentativa: startLoad e play
            primeiraTentativaFeita = true;
            stallStartTime = Date.now();
            setFaseSafe("instavel");
            onStallFirst();
          } else if (stallStartTime && Date.now() - stallStartTime >= 12_000) {
            // Continua travado por mais 12s: reconstrução completa
            stallStartTime = null;
            primeiraTentativaFeita = false;
            onStallRebuild();
          }
        }
      }, 2000);
    };

    /* --- Correção de atraso: só quando muito atrás da borda --- */
    // Todas as câmeras miram o mesmo ponto (3 s atrás da borda ao vivo),
    // para o mosaico ficar no mesmo instante.
    const corrigirAtraso = () => {
      if (video.buffered.length > 0) {
        const liveEdge = video.buffered.end(video.buffered.length - 1);
        const behindLive = liveEdge - video.currentTime;
        if (behindLive > 6 || behindLive < 0.5) {
          video.currentTime = Math.max(0, liveEdge - 3);
        }
      }
    };

    // Correção única ao retornar de aba oculta
    const onVisibility = () => {
      if (!document.hidden && !cancelado && hls) {
        corrigirAtraso();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    /* --- IntersectionObserver: suspende câmeras fora da tela --- */
    let suspenso = false;
    let tempoSuspenso = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (suspenso) {
              suspenso = false;
              // Retoma com startLoad antes de reconstruir
              try {
                hls?.startLoad(-1);
              } catch {
                /* ignora */
              }
              video.play().catch(() => {});
            }
            tempoSuspenso = 0;
          } else {
            if (!suspenso) {
              suspenso = true;
              tempoSuspenso = Date.now();
            }
            // Suspende se fora da área visível por mais de 30s
            if (suspenso && Date.now() - tempoSuspenso > 30_000) {
              try {
                hls?.stopLoad();
              } catch {
                /* ignora */
              }
            }
          }
        }
      },
      { threshold: 0 },
    );
    io.observe(video);

    /* --- Inicia --- */
    setFaseSafe("carregando");
    void iniciarPlayer();

    /* --- Cleanup --- */
    return () => {
      cancelado = true;
      if (reconexaoTimer) clearTimeout(reconexaoTimer);
      if (watchdog) clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* ignora */
        }
      }
      video.removeAttribute("src");
      video.srcObject = null;
      try {
        video.load();
      } catch {
        /* ignora */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHls, congelarQuadro]);

  /* ---- Retry automático: ao ficar sem imagem, tenta de novo sozinho ---- */
  useEffect(() => {
    if (fase !== "sem-video") return;
    const atraso = Math.min(2000 + tentativa * 2000, 20_000);
    const t = setTimeout(() => tentarDeNovo(), atraso);
    return () => clearTimeout(t);
  }, [fase, tentativa, tentarDeNovo]);

  // Aviso de primeiro quadro: nunca dispara de player desmontado/trocado.
  const limparAvisoQuadroRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      limparAvisoQuadroRef.current?.();
      limparAvisoQuadroRef.current = null;
    };
  }, [dvrId, canal]);

  /* ---- Prévia: última foto da câmera enquanto o vídeo não chega ---- */
  const chavePrevia = `${dvrId}:${canal}`;
  const [previa, setPrevia] = useState<string | null>(() => PREVIAS.get(`${dvrId}:${canal}`) ?? null);
  // Troca de câmera: mostra na hora a última imagem já vista desta câmera.
  useEffect(() => {
    setPrevia(PREVIAS.get(chavePrevia) ?? null);
  }, [chavePrevia]);
  // Ao sair (troca de layout), guarda o último quadro para reabrir sem "Carregando".
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      try {
        if (!video || video.videoWidth === 0) return;
        const c = document.createElement("canvas");
        const escala = Math.min(1, 640 / video.videoWidth);
        c.width = Math.round(video.videoWidth * escala);
        c.height = Math.round(video.videoHeight * escala);
        c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
        guardarPrevia(chavePrevia, c.toDataURL("image/jpeg", 0.7));
      } catch {
        /* quadro indisponível: mantém a prévia anterior */
      }
    };
  }, [chavePrevia]);
  useEffect(() => {
    if (segundoPlano || temImagem) return;
    let cancelado = false;
    let url: string | null = null;
    let tentativas = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buscar = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch(`/api/video/previa?dvr_id=${dvrId}&canal=${canal}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelado) return;
        if (res.status === 200) {
          const blob = await res.blob();
          if (cancelado) return;
          url = URL.createObjectURL(blob);
          guardarPrevia(chavePrevia, url);
          url = null; // o cache passa a ser o dono da URL
          setPrevia(PREVIAS.get(chavePrevia) ?? null);
          return;
        }
        // Sem foto ainda: o Agent foi avisado; tenta de novo algumas vezes.
        if (res.status === 204 && ++tentativas < 4) timer = setTimeout(buscar, 1500);
      } catch {
        /* sem prévia: segue o carregamento normal */
      }
    };
    void buscar();
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [dvrId, canal, chavePrevia, segundoPlano, temImagem]);

  /* ---- Render ---- */
  const mostrarSpinner =
    fase === "carregando" ||
    fase === "negociando" ||
    fase === "aguardando-fonte" ||
    fase === "reconectando";
  const mostrarErro = fase === "sem-video" || fase === "indisponivel";

  return (
    <div ref={containerRef} className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls={false}
        onPlaying={(e) => {
          const video = e.currentTarget;
          if (video.videoWidth === 0) return;
          setTemImagem(true);
          // Sinal real de quadro apresentado para a rotação de detecção
          // (só câmeras visíveis; pré-carregadas não contam).
          if (!segundoPlano) {
            limparAvisoQuadroRef.current?.();
            limparAvisoQuadroRef.current = aguardarQuadroApresentado(video, () =>
              window.dispatchEvent(
                new CustomEvent(EVENTO_PRIMEIRO_QUADRO, { detail: { dvrId, canal } }),
              ),
            );
          }
          if (modoVideo === "hls") return; // HLS nunca registra T8 do WebRTC
          // T8 só após o navegador apresentar um quadro no elemento.
          const rvfc = (
            video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
          ).requestVideoFrameCallback?.bind(video);
          if (rvfc) {
            rvfc(() =>
              confirmarPrimeiroQuadro(
                dvrId,
                canal,
                qualidadeAtiva,
                video,
                "requestVideoFrameCallback",
              ),
            );
          } else {
            const inicio = video.currentTime;
            const aoAvancar = () => {
              if (video.currentTime <= inicio || video.videoWidth === 0) return;
              video.removeEventListener("timeupdate", aoAvancar);
              confirmarPrimeiroQuadro(dvrId, canal, qualidadeAtiva, video, "fallback_timeupdate");
            };
            video.addEventListener("timeupdate", aoAvancar);
          }
        }}
        className={`h-full w-full transition-opacity duration-300 ${contido ? "object-contain" : "object-fill"} ${
          temImagem || congelado ? "" : "opacity-0"
        }`}
      />
      {previa && !temImagem && !congelado && (
        <img
          src={previa}
          alt=""
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full ${contido ? "object-contain" : "object-fill"}`}
        />
      )}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300 ${
          contido ? "object-contain" : "object-fill"
        } ${congelado ? "opacity-100" : "opacity-0"}`}
      />
      {congelado && !temImagem && (
        <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">
          <Loader2 className="h-3 w-3 animate-spin" /> Reconectando
        </div>
      )}
      {/* Sem pixels reais e sem quadro congelado/prévia: sempre mostra aviso,
          mesmo que a conexão se declare "ao vivo" — nunca quadrado preto mudo. */}
      {!congelado && (!temImagem || mostrarErro) && !(previa && !mostrarErro) && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/70 ${temImagem ? "bg-black/25" : ""}`}
        >
          {indisponivel ? (
            <>
              <Camera className="h-7 w-7" />
              <span className="px-2 text-center text-[11px]">Sem imagem</span>
              <button
                type="button"
                onClick={tentarDeNovo}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-white/25 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/10"
              >
                <RotateCw className="h-3 w-3" /> Tentar novamente
              </button>
            </>
          ) : temImagem ? null : ( // Já existe imagem na tela: nada de aviso, apenas mantém o quadro.
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span
                className="px-2 text-center text-[11px]"
                title={
                  [detalheWebrtc, faseIceTexto, tentativa ? `tentativa ${tentativa}` : null]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              >
                {fase === "sem-video" || fase === "ao-vivo"
                  ? `${MENSAGENS["sem-video"]}…`
                  : MENSAGENS[fase]}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
