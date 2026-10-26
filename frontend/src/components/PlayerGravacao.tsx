import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  liberarArquivo,
  pedirArquivo,
  statusArquivo,
  type StatusExport,
} from "@/lib/gravacoes-export";

export type TrechoGravacao = {
  id: string;
  inicio: string;
  duracaoSegundos: number;
  inicioEpochMs?: number | null;
  /** Endereço do próprio servidor local, quando o navegador estiver na mesma rede. */
  urlLocal?: string | null;
};

type Props = {
  titulo: string;
  /** Todos os trechos da câmera no período, em ordem crescente de horário. */
  trechos: TrechoGravacao[];
  indiceInicial?: number;
  posicaoInicial?: number;
  onFechar: () => void;
  /** Oculta a barra de título superior (usado em tela cheia da página). */
  semCabecalho?: boolean;
};

const VELOCIDADES = [0.5, 1, 1.5, 2, 4, 8];
/** Tempo máximo de espera pelo servidor local antes de usar a cópia da nuvem. */
const ESPERA_LOCAL_MS = 6000;

type ArquivoEstado = {
  exportId: string | null;
  url: string | null;
  erro: string | null;
  enviando: boolean;
  /** O servidor local está convertendo a cópia para um formato que o navegador toca. */
  convertendo: boolean;
  bytes: number;
  total: number | null;
};

function formatarRelogio(ms: number) {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatarBytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export function PlayerGravacao({
  titulo,
  trechos,
  indiceInicial = 0,
  posicaoInicial = 0,
  onFechar,
  semCabecalho = false,
}: Props) {
  /** Dois elementos de vídeo alternados: evita tela preta ao trocar de arquivo. */
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ativo, setAtivo] = useState<0 | 1>(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const [indice, setIndice] = useState(Math.max(0, Math.min(indiceInicial, trechos.length - 1)));
  const [arquivos, setArquivos] = useState<Record<string, ArquivoEstado>>({});
  const [midiaPronta, setMidiaPronta] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [posicao, setPosicao] = useState(posicaoInicial);
  const [velocidade, setVelocidade] = useState(1);
  const [formatoInvalido, setFormatoInvalido] = useState(false);
  const [duracoes, setDuracoes] = useState<Record<string, number>>({});
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [controlesVisiveis, setControlesVisiveis] = useState(true);
  const cliqueTimer = useRef<number | null>(null);
  /** Exportações abertas por este player (liberadas ao fechar/trocar). */
  const abertas = useRef<Set<string>>(new Set());
  const buscaPendente = useRef<number>(posicaoInicial);
  /** Fila de recebimento dos arquivos; pode ser reordenada ao buscar um horário. */
  const fila = useRef<string[]>([]);
  const [bufferSegundos, setBufferSegundos] = useState(0);
  /** Muda a cada nova tentativa, reiniciando o ciclo de recebimento. */
  const [reinicios, setReinicios] = useState(0);
  /** Verdadeiro quando o servidor local não responde e a nuvem assume. */
  const [redeLocalFalhou, setRedeLocalFalhou] = useState(false);
  const arquivosRef = useRef(arquivos);
  arquivosRef.current = arquivos;
  /** Último endereço para o qual já se pediu renovação da URL assinada. */
  const renovadoPara = useRef<string | null>(null);

  /** Limpa as falhas e pede tudo de novo, reaproveitando o que já chegou. */
  const tentarNovamente = useCallback(() => {
    setFormatoInvalido(false);
    setRedeLocalFalhou(false);
    setArquivos((atual) => {
      const proximo: Record<string, ArquivoEstado> = {};
      for (const [id, a] of Object.entries(atual)) {
        proximo[id] = { ...a, erro: null, enviando: a.url ? a.enviando : false };
      }
      return proximo;
    });
    setReinicios((n) => n + 1);
  }, []);

  /** Coloca o trecho pedido na frente da fila de recebimento. */
  const priorizar = useCallback((id: string) => {
    const pos = fila.current.indexOf(id);
    if (pos > 0) {
      fila.current.splice(pos, 1);
      fila.current.unshift(id);
    }
  }, []);

  const trecho = trechos[indice];

  const inicioDe = useCallback(
    (t: TrechoGravacao) =>
      typeof t.inicioEpochMs === "number" && Number.isFinite(t.inicioEpochMs)
        ? t.inicioEpochMs
        : +new Date(t.inicio),
    [],
  );

  const duracaoDe = useCallback(
    (i: number) => {
      const t = trechos[i];
      if (!t) return 0;
      const medida = duracoes[t.id];
      if (medida && Number.isFinite(medida) && medida > 0) return medida;
      if (t.duracaoSegundos > 0) return t.duracaoSegundos;
      const prox = trechos[i + 1];
      if (prox) {
        const d = (inicioDe(prox) - inicioDe(t)) / 1000;
        if (d > 0 && d < 3600) return d;
      }
      return 300;
    },
    [duracoes, inicioDe, trechos],
  );

  const linha = useMemo(() => {
    const blocos = trechos.map((t, i) => ({
      de: inicioDe(t),
      ate: inicioDe(t) + duracaoDe(i) * 1000,
    }));
    const de = blocos.length ? Math.min(...blocos.map((b) => b.de)) : 0;
    const ate = blocos.length ? Math.max(...blocos.map((b) => b.ate)) : de + 1000;
    return { blocos, de, ate };
  }, [duracaoDe, inicioDe, trechos]);

  const inicioMs = trecho ? inicioDe(trecho) : 0;
  /** Valor da barra enquanto o usuário arrasta (segundos epoch); null fora do arraste. */
  const [arrasto, setArrasto] = useState<number | null>(null);
  const relogioAtual = arrasto !== null ? arrasto * 1000 : inicioMs + posicao * 1000;
  const faixaMs = Math.max(1, linha.ate - linha.de);

  // ---- Baixa TODOS os trechos do período, começando pelo que está tocando ----
  const chaveTrechos = trechos.map((t) => t.id).join("|");
  useEffect(() => {
    if (!trechos.length) return;
    let cancelado = false;

    const anotar = (id: string, dados: Partial<ArquivoEstado>) => {
      if (cancelado) return;
      setArquivos((atual) => ({
        ...atual,
        [id]: {
          exportId: null,
          url: null,
          erro: null,
          enviando: false,
          convertendo: false,
          bytes: 0,
          total: null,
          ...atual[id],
          ...dados,
        },
      }));
    };

    const aplicar = (id: string, s: StatusExport) => {
      if (s.estado === "erro") {
        anotar(id, {
          exportId: s.export_id,
          erro: s.erro || "O servidor local não conseguiu enviar esta gravação.",
        });
        return true;
      }
      anotar(id, {
        exportId: s.export_id,
        url: s.download_url,
        enviando: s.estado === "enviando",
        convertendo: (s.etapa ?? "").includes("convert"),
        bytes: s.bytes_enviados,
        total: s.tamanho_bytes,
      });
      return Boolean(s.download_url);
    };

    const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Acompanha um arquivo já solicitado até ficar disponível (ou falhar). */
    const acompanhar = async (id: string, inicial: StatusExport) => {
      try {
        if (cancelado) {
          void liberarArquivo(inicial.export_id);
          return;
        }
        abertas.current.add(inicial.export_id);
        if (aplicar(id, inicial)) return;
        let ultimosBytes = 0;
        let ultimoAvanco = Date.now();
        while (!cancelado) {
          await esperar(2000);
          if (cancelado) return;
          const s = await statusArquivo(inicial.export_id);
          if (s.bytes_enviados > ultimosBytes) {
            ultimosBytes = s.bytes_enviados;
            ultimoAvanco = Date.now();
          }
          if (aplicar(id, s)) return;
          if (Date.now() - ultimoAvanco > 300_000) {
            anotar(id, {
              erro: "O servidor local não avançou no envio desta gravação nos últimos 5 minutos.",
            });
            return;
          }
        }
      } catch (e) {
        anotar(id, { erro: e instanceof Error ? e.message : "Falha ao solicitar a gravação." });
      }
    };

    // Prepara todo o período em ordem, com no máximo duas gravações ao mesmo
    // tempo. Assim a primeira abre imediatamente e as demais ficam prontas
    // antes de a reprodução chegar nelas, sem exceder o limite do Agent.
    const partida = Math.max(0, Math.min(indice, trechos.length - 1));
    const alvos = [...trechos.slice(partida), ...trechos.slice(0, partida)];
    fila.current = alvos
      // Com endereço local válido, a rede local é tentada primeiro.
      .filter((t) => redeLocalFalhou || !t.urlLocal)
      .map((t) => t.id)
      .filter((id) => {
        const a = arquivosRef.current[id];
        return !(a && (a.url || a.erro));
      });

    const trabalhar = async () => {
      while (!cancelado) {
        const id = fila.current.shift();
        if (!id) return;
        const existente = arquivosRef.current[id];
        if (existente && (existente.url || existente.erro)) continue;
        try {
          const inicial = await pedirArquivo(id);
          await acompanhar(id, inicial);
        } catch (e) {
          anotar(id, { erro: e instanceof Error ? e.message : "Falha ao solicitar a gravação." });
        }
      }
    };
    void Promise.all([trabalhar(), trabalhar()]);

    // Mantém as reservas vivas enquanto o player estiver aberto.
    const renovar = setInterval(() => {
      for (const id of abertas.current) void statusArquivo(id).catch(() => {});
    }, 60_000);

    return () => {
      cancelado = true;
      clearInterval(renovar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveTrechos, reinicios, redeLocalFalhou, indice]);

  const arquivoAtual = trecho ? arquivos[trecho.id] : undefined;
  /** Preferência: arquivo servido pelo próprio servidor do cliente na rede local. */
  const urlLocalAtual = redeLocalFalhou ? null : (trecho?.urlLocal ?? null);
  const url = urlLocalAtual ?? arquivoAtual?.url ?? null;
  const usandoLocal = Boolean(urlLocalAtual) && url === urlLocalAtual;
  const progresso = arquivoAtual
    ? { bytes_enviados: arquivoAtual.bytes, tamanho_bytes: arquivoAtual.total }
    : null;
  const estado: "preparando" | "enviando" | "pronto" | "erro" = formatoInvalido
    ? "erro"
    : arquivoAtual?.erro
      ? "erro"
      : url && midiaPronta
        ? "pronto"
        : arquivoAtual?.enviando
          ? "enviando"
          : "preparando";
  const mensagem = formatoInvalido
    ? "O navegador não reproduz o formato deste arquivo."
    : (arquivoAtual?.erro ?? "");
  // ---- Reproduz direto pela URL assinada, carregando no elemento reserva ----
  // O trecho seguinte é preparado num segundo <video> e só aparece quando já
  // tem imagem, então a troca acontece sem piscar preto.
  useEffect(() => {
    if (!url) return;
    const anterior = videoRef.current;
    const destino = (anterior === aRef.current ? bRef.current : aRef.current) ?? aRef.current;
    if (!destino) return;
    const alvo = buscaPendente.current;
    setFormatoInvalido(false);
    if (!anterior) setMidiaPronta(false);
    // Fora da rede do cliente o endereço local nunca responde: espera curta e
    // troca automaticamente para a cópia enviada à nuvem.
    const limiteLocal = usandoLocal
      ? window.setTimeout(() => setRedeLocalFalhou(true), ESPERA_LOCAL_MS)
      : null;

    let trocado = false;
    const mostrar = () => {
      if (limiteLocal) window.clearTimeout(limiteLocal);
      if (trocado) return;
      trocado = true;
      videoRef.current = destino;
      setAtivo(destino === aRef.current ? 0 : 1);
      setMidiaPronta(true);
      if (anterior && anterior !== destino) {
        anterior.pause();
      }
    };

    const aoCarregar = () => {
      const d = destino.duration;
      if (trecho && Number.isFinite(d) && d > 0) {
        setDuracoes((atual) => (atual[trecho.id] === d ? atual : { ...atual, [trecho.id]: d }));
      }
      if (alvo > 0 && Number.isFinite(d) && d > 0) {
        try {
          // Duração estimada maior que a real: em vez de cair no fim (e pular
          // de volta para o trecho seguinte), começa 10 s antes do fim.
          destino.currentTime = alvo >= d - 1 ? Math.max(0, d - 10) : alvo;
        } catch {
          /* ignora */
        }
      }
      destino.playbackRate = velocidade;
      if (!pausado) void destino.play().catch(() => {});
      else mostrar();
    };
    const mostrarQuandoPronto = () => {
      if (destino.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) mostrar();
    };
    const falhou = () => {
      // Servidor local fora de alcance (usuário remoto): passa para a nuvem.
      if (usandoLocal) {
        setRedeLocalFalhou(true);
        return;
      }
      // URL assinada vencida numa reprodução longa: pede uma nova e retoma
      // do mesmo ponto (uma vez por endereço).
      const exportId = trecho ? arquivosRef.current[trecho.id]?.exportId : null;
      if (trecho && exportId && renovadoPara.current !== url) {
        renovadoPara.current = url;
        const idTrecho = trecho.id;
        buscaPendente.current = destino.currentTime || buscaPendente.current;
        void statusArquivo(exportId)
          .then((s) => {
            if (s.download_url && s.download_url !== url) {
              setArquivos((a) => ({ ...a, [idTrecho]: { ...a[idTrecho]!, url: s.download_url } }));
            } else {
              setFormatoInvalido(true);
            }
          })
          .catch(() => setFormatoInvalido(true));
        return;
      }
      setFormatoInvalido(true);
      setMidiaPronta(false);
      mostrar();
    };

    destino.addEventListener("loadedmetadata", aoCarregar);
    destino.addEventListener("loadeddata", mostrar);
    destino.addEventListener("canplay", mostrar);
    destino.addEventListener("seeked", mostrarQuandoPronto);
    destino.addEventListener("timeupdate", mostrarQuandoPronto);
    destino.addEventListener("playing", mostrar);
    destino.addEventListener("error", falhou);

    // Os sinais precisam estar registrados antes de definir o endereço. Em
    // rede local ou com arquivo em cache, o primeiro quadro pode chegar no
    // mesmo instante e o navegador não repete o evento depois.
    destino.src = url;
    destino.load();
    mostrarQuandoPronto();

    return () => {
      if (limiteLocal) window.clearTimeout(limiteLocal);
      destino.removeEventListener("loadedmetadata", aoCarregar);
      destino.removeEventListener("loadeddata", mostrar);
      destino.removeEventListener("canplay", mostrar);
      destino.removeEventListener("seeked", mostrarQuandoPronto);
      destino.removeEventListener("timeupdate", mostrarQuandoPronto);
      destino.removeEventListener("playing", mostrar);
      destino.removeEventListener("error", falhou);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Posição a partir do próprio vídeo (não depende da velocidade).
  useEffect(() => {
    if (estado !== "pronto" || pausado) return;
    const timer = window.setInterval(() => {
      const atual = videoRef.current?.currentTime;
      if (typeof atual === "number" && Number.isFinite(atual)) setPosicao(Math.max(0, atual));
    }, 250);
    return () => window.clearInterval(timer);
  }, [estado, pausado]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = velocidade;
  }, [velocidade, estado, url]);

  // Quanto do trecho atual o navegador já carregou (avança durante a exibição).
  useEffect(() => {
    if (!url) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const b = video.buffered;
      let fim = 0;
      for (let i = 0; i < b.length; i += 1) {
        if (b.start(i) <= video.currentTime + 0.5) fim = Math.max(fim, b.end(i));
      }
      setBufferSegundos(fim);
    }, 500);
    return () => window.clearInterval(timer);
  }, [url]);

  const abrirTrecho = useCallback(
    (novo: number, segundos: number) => {
      const alvo = Math.max(0, Math.min(novo, trechos.length - 1));
      const idAlvo = trechos[alvo]?.id;
      if (idAlvo) priorizar(idAlvo);
      buscaPendente.current = Math.max(0, segundos);
      setPosicao(Math.max(0, segundos));
      if (alvo === indice) {
        const video = videoRef.current;
        if (video && url) {
          const destino = Math.max(0, segundos);
          try {
            video.currentTime = destino;
          } catch {
            /* ignora */
          }
          if (!pausado) void video.play().catch(() => {});
          // Alguns servidores não deixam pular para trás no arquivo já aberto:
          // se o navegador não aceitou a nova posição, reabre o arquivo nela.
          window.setTimeout(() => {
            if (videoRef.current !== video) return;
            if (Math.abs(video.currentTime - destino) <= 3) return;
            const aoAbrir = () => {
              video.removeEventListener("loadedmetadata", aoAbrir);
              try {
                video.currentTime = destino;
              } catch {
                /* ignora */
              }
              if (!pausado) void video.play().catch(() => {});
            };
            video.addEventListener("loadedmetadata", aoAbrir);
            const src = video.currentSrc || url;
            video.src = src;
            video.load();
          }, 1200);
        }
        return;
      }
      setIndice(alvo);
    },
    [indice, pausado, priorizar, trechos, url],
  );

  const irParaHorario = useCallback(
    (ms: number, recuando = false) => {
      const alvo = Math.max(linha.de, Math.min(linha.ate, ms));
      const blocoAtual = linha.blocos[indice];
      /** Trecho que contém o horário pedido (prefere o atual quando houver sobreposição). */
      const contem = (t: number) => {
        if (blocoAtual && t >= blocoAtual.de && t <= blocoAtual.ate) return indice;
        return linha.blocos.findIndex((b) => t >= b.de && t <= b.ate);
      };
      /** Trecho mais recente que começa antes de `limite` (pelo horário). */
      const anteriorA = (limite: number, excluir: number) => {
        let melhor = -1;
        linha.blocos.forEach((b, i) => {
          if (i === excluir || b.de >= limite) return;
          if (melhor < 0 || b.de > (linha.blocos[melhor]?.de ?? 0)) melhor = i;
        });
        return melhor;
      };
      const perto = (i: number, t: number) => {
        const b = linha.blocos[i]!;
        const ponto = t >= b.de && t < b.ate - 1000 ? t : Math.max(b.de, b.ate - 10_000);
        abrirTrecho(i, (ponto - b.de) / 1000);
      };

      let escolhido = contem(alvo);
      // Voltar 10 s logo no começo do trecho atual: vai para o fim do anterior.
      if (recuando && escolhido === indice && blocoAtual && alvo <= blocoAtual.de + 500) {
        const ant = anteriorA(blocoAtual.de, indice);
        if (ant >= 0) {
          perto(ant, alvo);
          return;
        }
      }
      if (escolhido < 0) {
        if (recuando) {
          // Caiu numa lacuna sem gravação: abre o trecho logo antes dela, perto do fim.
          const ant = anteriorA(alvo, -1);
          if (ant >= 0) {
            perto(ant, alvo);
            return;
          }
        }
        escolhido = linha.blocos.findIndex((b) => b.de >= alvo);
        if (escolhido < 0) escolhido = linha.blocos.length - 1;
      }
      const bloco = linha.blocos[escolhido];
      if (!bloco) return;
      abrirTrecho(escolhido, Math.max(0, (Math.max(alvo, bloco.de) - bloco.de) / 1000));
    },
    [abrirTrecho, indice, linha],
  );

  const aoTerminar = useCallback(() => {
    if (indice + 1 < trechos.length) abrirTrecho(indice + 1, 0);
    else setPausado(true);
  }, [abrirTrecho, indice, trechos.length]);

  const alternar = () => {
    const video = videoRef.current;
    if (!video) return;
    if (pausado) {
      void video.play().catch(() => {});
      setPausado(false);
    } else {
      video.pause();
      setPausado(true);
    }
  };

  const telaCheia = () => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void caixa.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const aoMudar = () => {
      const fs = Boolean(document.fullscreenElement);
      setEmTelaCheia(fs);
      if (!fs) setControlesVisiveis(true);
    };
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  /** Clique simples: mostra/esconde controles (em tela cheia). Dois cliques: alterna tela cheia. */
  const aoClicarVideo = () => {
    if (cliqueTimer.current) {
      window.clearTimeout(cliqueTimer.current);
      cliqueTimer.current = null;
      telaCheia();
      return;
    }
    cliqueTimer.current = window.setTimeout(() => {
      cliqueTimer.current = null;
      if (document.fullscreenElement) setControlesVisiveis((v) => !v);
    }, 250);
  };

  // Ao fechar o player (ou a aba) os arquivos temporários são apagados.
  useEffect(() => {
    const liberarTudo = () => {
      for (const id of abertas.current) void liberarArquivo(id, true);
      abertas.current.clear();
    };
    window.addEventListener("pagehide", liberarTudo);
    return () => {
      window.removeEventListener("pagehide", liberarTudo);
      liberarTudo();
    };
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const emCheia = Boolean(document.fullscreenElement);
      if (emCheia) {
        // Garante a saída da tela cheia mesmo quando o navegador não trata o Esc.
        e.preventDefault();
        void document.exitFullscreen().catch(() => {});
        return;
      }
      onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const percentual =
    progresso && progresso.tamanho_bytes
      ? Math.min(100, Math.round((progresso.bytes_enviados / progresso.tamanho_bytes) * 100))
      : null;

  const ocultarControles = emTelaCheia && !controlesVisiveis;
  /** Layout de preenchimento: tela cheia individual ou tela cheia global (semCabecalho). */
  const preencher = emTelaCheia || semCabecalho;

  return (
    <div
      ref={caixaRef}
      className={`overflow-hidden rounded-lg border bg-card ${
        preencher ? "flex h-full w-full flex-col rounded-none border-0 bg-black" : ""
      }`}
    >
      <div
        className={`flex items-center justify-between border-b px-4 py-2 ${
          preencher ? "hidden" : ocultarControles ? "hidden" : ""
        }`}
      >
        <span className="truncate text-sm font-medium">{titulo}</span>
        <Button variant="ghost" size="icon" onClick={onFechar} aria-label="Fechar reprodução">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div
        className={`relative bg-black ${preencher ? "min-h-0 flex-1" : "aspect-video"} ${
          ocultarControles ? "cursor-none" : ""
        }`}
        onClick={aoClicarVideo}
      >
        <video
          ref={aRef}
          className={`absolute inset-0 h-full w-full ${ativo === 0 ? "z-10 opacity-100" : "z-0 opacity-0"}`}
          autoPlay
          playsInline
          preload="auto"
          controlsList="nodownload"
          onEnded={(e) => {
            if (e.currentTarget === videoRef.current) aoTerminar();
          }}
        />
        <video
          ref={bRef}
          className={`absolute inset-0 h-full w-full ${ativo === 1 ? "z-10 opacity-100" : "z-0 opacity-0"}`}
          autoPlay
          playsInline
          preload="auto"
          controlsList="nodownload"
          onEnded={(e) => {
            if (e.currentTarget === videoRef.current) aoTerminar();
          }}
        />
        {estado !== "pronto" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center text-sm text-muted-foreground">
            {estado === "erro" ? (
              <>
                <span className="text-destructive">Erro para buscar imagem</span>
                {mensagem && (
                  <span className="max-w-md text-xs text-muted-foreground/80" title={mensagem}>
                    {mensagem}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={tentarNovamente}
                >
                  <RotateCw className="h-4 w-4" /> Tentar novamente
                </Button>
                {formatoInvalido && url && (
                  <a
                    href={url}
                    download
                    className="inline-flex items-center gap-2 text-xs underline"
                  >
                    <Download className="h-3.5 w-3.5" /> Baixar o arquivo original
                  </a>
                )}
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>
                  {estado === "enviando"
                    ? "Recebendo a gravação do servidor local..."
                    : arquivoAtual?.convertendo
                      ? "Preparando a gravação para tocar no navegador..."
                      : "Localizando a gravação no servidor local..."}
                </span>
                {progresso && progresso.bytes_enviados > 0 && (
                  <span className="text-xs tabular-nums">
                    {percentual !== null ? `${percentual}% · ` : ""}
                    {formatarBytes(progresso.bytes_enviados)}
                    {progresso.tamanho_bytes
                      ? ` de ${formatarBytes(progresso.tamanho_bytes)}`
                      : ""}
                  </span>
                )}
                {percentual !== null && (
                  <div className="h-1.5 w-56 overflow-hidden rounded bg-muted/40">
                    <div className="h-full bg-primary" style={{ width: `${percentual}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div
        className={`space-y-2 px-3 py-2 ${
          preencher
            ? "border-t border-white/10 bg-black/85 text-white"
            : "space-y-3 border-t bg-card px-4 py-3"
        } ${ocultarControles ? "hidden" : ""}`}
      >
        <div className="relative">
          {arrasto !== null && (
            <div
              className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded bg-popover px-2 py-1 text-xs font-medium tabular-nums text-popover-foreground shadow-md ring-1 ring-border"
              style={{
                left: `${Math.min(100, Math.max(0, ((arrasto * 1000 - linha.de) / faixaMs) * 100))}%`,
              }}
            >
              {formatarRelogio(arrasto * 1000)}
            </div>
          )}
          <Slider
            value={[arrasto ?? Math.round(relogioAtual / 1000)]}
            min={Math.floor(linha.de / 1000)}
            max={Math.max(Math.floor(linha.de / 1000) + 1, Math.ceil(linha.ate / 1000))}
            step={1}
            disabled={estado !== "pronto"}
            onValueChange={(valor) => setArrasto(valor[0] ?? 0)}
            onValueCommit={(valor) => {
              const alvoMs = (valor[0] ?? 0) * 1000;
              setArrasto(null);
              irParaHorario(alvoMs, alvoMs < inicioMs + posicao * 1000);
            }}
            aria-label="Horário da gravação"
          />
          {/* Mostra o que já está carregado (pode ser assistido na hora). */}
          <div className="relative mt-1 h-1 w-full overflow-hidden rounded bg-muted/50">
            {linha.blocos.map((b, i) => {
              const t = trechos[i];
              const a = t ? arquivos[t.id] : undefined;
              const carregado = Boolean(a?.url);
              const recebendo = !carregado && Boolean(a) && !a?.erro;
              if (!carregado && !recebendo) return null;
              const inicioPct = ((b.de - linha.de) / faixaMs) * 100;
              const fimBuffer =
                i === indice && bufferSegundos > 0
                  ? Math.min(b.ate, b.de + bufferSegundos * 1000)
                  : b.ate;
              const largura = Math.max(
                0.5,
                (((carregado ? fimBuffer : b.ate) - b.de) / faixaMs) * 100,
              );
              return (
                <div
                  key={t?.id ?? i}
                  className={`absolute inset-y-0 ${carregado ? "bg-primary/70" : "bg-primary/25"}`}
                  style={{ left: `${inicioPct}%`, width: `${largura}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-32 flex-col gap-0.5">
            {emTelaCheia && (
              <span className="truncate text-xs font-medium text-white/90">{titulo}</span>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatarRelogio(relogioAtual)} / {formatarRelogio(linha.ate)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={estado !== "pronto"}
              onClick={() => irParaHorario(relogioAtual - 10_000)}
              aria-label="Voltar 10 segundos"
              title="Voltar 10 segundos"
            >
              <RotateCcw />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              disabled={estado !== "pronto"}
              onClick={alternar}
              aria-label={pausado ? "Reproduzir" : "Pausar"}
              title={pausado ? "Reproduzir" : "Pausar"}
            >
              {pausado ? <Play /> : <Pause />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={estado !== "pronto"}
              onClick={() => irParaHorario(relogioAtual + 10_000)}
              aria-label="Avançar 10 segundos"
              title="Avançar 10 segundos"
            >
              <RotateCw />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(velocidade)}
              onValueChange={(v) => setVelocidade(Number(v))}
              disabled={estado !== "pronto"}
            >
              <SelectTrigger
                className="h-7 w-[72px] px-2 text-[11px] tabular-nums"
                aria-label="Velocidade de reprodução"
                title="Velocidade de reprodução"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VELOCIDADES.map((v) => (
                  <SelectItem key={v} value={String(v)} className="text-xs tabular-nums">
                    {v}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={telaCheia}
              aria-label={emTelaCheia ? "Sair da tela cheia" : "Tela cheia"}
              title={emTelaCheia ? "Sair da tela cheia (Esc)" : "Tela cheia"}
            >
              {emTelaCheia ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
