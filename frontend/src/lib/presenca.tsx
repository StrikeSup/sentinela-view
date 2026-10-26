import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { idDaAba } from "@/lib/webrtc-sessions";
import {
  reservarTelas,
  abrirIdentificacoesMonitores,
  lerTelasVivas,
  enviarLayoutParaTela,
  restaurarTelas,
  garantirMonitoresDetectados,
  lembrarTelaDaJanela,
  listarMonitores,
  monitorDaPosicao,
  monitoresAutorizados,
  monitoresConhecidos,
  suportaMonitores,
  paramsDaTela,
  telaLembradaDaJanela,
  type TelaExtra,
} from "@/lib/telas-extras";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type LayoutForcado = { id: string; em: string } | null;
type SolicitacaoTelas = { id: string; em: string; sessaoId: string; telas: TelaExtra[] };

type Ctx = {
  /** Informa qual layout/mosaico está sendo exibido nesta aba */
  setLayoutAtual: (id: string | null) => void;
  /** Layout enviado por um supervisor pela tela de Monitoramento */
  layoutForcado: LayoutForcado;
};

const PresencaContext = createContext<Ctx>({
  setLayoutAtual: () => {},
  layoutForcado: null,
});

const INTERVALO_MS = 10_000;
/** sessões do próprio usuário sem sinal por mais que isto são apagadas */
const VENCIMENTO_MS = 90_000;

export function PresencaProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.access_token ?? null;
  const { clienteId } = useClienteSelecionado();
  const rota = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const [layoutAtual, setLayoutAtualState] = useState<string | null>(null);
  const [layoutForcado, setLayoutForcado] = useState<LayoutForcado>(null);
  const [identificacao, setIdentificacao] = useState<{
    numero: number | null;
    total: number | null;
    em: string;
  } | null>(null);
  const [solicitacaoTelas, setSolicitacaoTelas] = useState<SolicitacaoTelas | null>(null);
  const [contagemAbertura, setContagemAbertura] = useState<number | null>(null);
  const ultimaIdentificacaoEm = useRef<string | null>(null);

  const setLayoutAtual = useCallback((id: string | null) => {
    setLayoutAtualState((prev) => (prev === id ? prev : id));
  }, []);

  const mostrarIdentificacao = useCallback(async (em: string) => {
    let numero: number | null = null;
    let total: number | null = null;
    try {
      if (await monitoresAutorizados()) {
        const monitores = await listarMonitores(true);
        const monitor = monitorDaPosicao(
          monitores,
          window.screenX,
          window.screenY,
          window.outerWidth,
          window.outerHeight,
        );
        numero = monitor?.numero || null;
        total = monitores.length || null;
      }
    } catch {
      // Sem permissão, a caixa ainda identifica a janela correta sem inventar número.
    }
    setIdentificacao({ em, numero, total });
  }, []);

  const mostrarTodosOsMonitores = useCallback(async () => {
    const monitores = await monitoresConhecidos();
    if (!monitores.length) {
      toast.error("Nenhum monitor foi detectado neste computador.");
      return;
    }
    const abrir = () => abrirIdentificacoesMonitores(monitores);
    const resultado = abrir();
    if (!resultado.bloqueadas) {
      toast.success(`Identificação exibida em ${resultado.abertas} monitor${resultado.abertas === 1 ? "" : "es"}.`);
      return;
    }
    toast.error(
      `${resultado.bloqueadas} identificação${resultado.bloqueadas === 1 ? " foi bloqueada" : " foram bloqueadas"}. Libere os pop-ups e tente novamente.`,
      {
        duration: 12_000,
        action: {
          label: "Tentar novamente",
          onClick: () => {
            const nova = abrir();
            if (!nova.bloqueadas) toast.success("Monitores identificados.");
          },
        },
      },
    );
  }, []);

  // mantém os últimos valores para o heartbeat periódico
  const dados = useRef({ rota, clienteId, layoutAtual });
  dados.current = { rota, clienteId, layoutAtual };

  const userId = user?.id ?? null;
  // cada janela precisa de uma sessão própria: popups herdam o sessionStorage
  // do opener, então as telas extras usam o id da tela (vem na URL)
  const sessao =
    typeof window === "undefined"
      ? "ssr"
      : (() => {
          const tela = paramsDaTela();
          if (tela) {
            // guarda na própria janela: ela continua sendo esta tela mesmo
            // que o endereço mude (menu, recarga, sessão restaurada)
            lembrarTelaDaJanela(tela.id);
            return `tela-${tela.id}`;
          }
          const lembrada = telaLembradaDaJanela();
          return lembrada ? `tela-${lembrada}` : idDaAba();
        })();
  const janelaPrincipal = !sessao.startsWith("tela-");

  const limparSolicitacao = useCallback(async (solicitacao: SolicitacaoTelas) => {
    setSolicitacaoTelas((atual) => (atual?.id === solicitacao.id ? null : atual));
    await (supabase.from("sessoes_usuario") as unknown as {
      update: (valor: Record<string, unknown>) => {
        eq: (campo: string, valor: string) => Promise<{ error: unknown }>;
      };
    }).update({ abrir_telas: null, abrir_telas_em: null, abrir_telas_por: null }).eq("id", solicitacao.sessaoId);
  }, []);

  const abrirTelasSolicitadas = useCallback((solicitacao: SolicitacaoTelas) => {
    // A reserva precisa ocorrer dentro deste clique para o navegador liberar todas as janelas.
    // O monitor onde esta janela principal está já é uma tela: ela recebe o
    // mosaico daquele monitor em vez de abrir uma janela a mais por cima.
    const cx = window.screenX + window.outerWidth / 2;
    const cy = window.screenY + window.outerHeight / 2;
    const daPrincipal = solicitacao.telas.find(
      (t) => cx >= t.left && cx < t.left + t.width && cy >= t.top && cy < t.top + t.height,
    );
    const telas = daPrincipal ? solicitacao.telas.filter((t) => t !== daPrincipal) : solicitacao.telas;
    if (daPrincipal?.layoutId) {
      setLayoutForcado({ id: daPrincipal.layoutId, em: new Date().toISOString() });
      // o mosaico da janela principal só aparece na tela de Visualização:
      // se ela estiver em outra página, leva o usuário para lá
      if (window.location.pathname !== "/visualizacao") {
        void navigate({ to: "/visualizacao" });
      }
    }
    // Telas já abertas num monitor da solicitação só trocam de mosaico:
    // nada de abrir outra janela por cima.
    const vivas = lerTelasVivas();
    const usadas = new Set<string>();
    let trocadas = 0;
    const aAbrir = telas.filter((t) => {
      const viva =
        vivas.find((v) => v.id === t.id && !usadas.has(v.id)) ??
        vivas.find((v) => {
          if (usadas.has(v.id)) return false;
          const vx = v.left + v.width / 2;
          const vy = v.top + v.height / 2;
          return vx >= t.left && vx < t.left + t.width && vy >= t.top && vy < t.top + t.height;
        });
      if (!viva) return true;
      usadas.add(viva.id);
      enviarLayoutParaTela(viva.id, t.layoutId, t.clienteId ?? viva.clienteId ?? null);
      trocadas++;
      return false;
    });
    solicitacao = { ...solicitacao, telas: aAbrir };
    void limparSolicitacao(solicitacao);
    if (!aAbrir.length) {
      toast.success(`Mosaicos trocados em ${trocadas + (daPrincipal ? 1 : 0)} tela(s).`);
      return;
    }
    const reservadas = reservarTelas(aAbrir);
    void restaurarTelas(aAbrir, undefined, reservadas).then((resultado) => {
      if (resultado.bloqueadas.length) {
        toast.error(`O navegador bloqueou ${resultado.bloqueadas.length} tela${resultado.bloqueadas.length === 1 ? "" : "s"}. Libere pop-ups e tente novamente.`);
      } else {
        toast.success(`${resultado.abertas} tela(s) aberta(s)${trocadas ? `, ${trocadas} trocada(s)` : ""}.`);
      }
    });
  }, [limparSolicitacao]);

  // Ao receber a solicitação, conta 5 segundos e abre sozinha se não for recusada
  useEffect(() => {
    if (!solicitacaoTelas) {
      setContagemAbertura(null);
      return;
    }
    setContagemAbertura(5);
    const inicio = Date.now();
    const cronometro = window.setInterval(() => {
      const restante = 5 - Math.floor((Date.now() - inicio) / 1000);
      if (restante <= 0) {
        window.clearInterval(cronometro);
        abrirTelasSolicitadas(solicitacaoTelas);
        return;
      }
      setContagemAbertura(restante);
    }, 250);
    return () => window.clearInterval(cronometro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitacaoTelas?.id]);

  const publicar = useCallback(async () => {
    if (!userId) return;
    const { rota: r, clienteId: c, layoutAtual: l } = dados.current;

    // monitores do computador desta janela: o supervisor usa isso na tela de
    // Monitoramento para organizar as telas do usuário
    let monitores: unknown = null;
    let monitorNumero: number | null = null;
    try {
      {
        // usa a lista ao vivo quando há permissão; senão a última detectada
        // neste computador e, em último caso, a tela atual
        const lista = await monitoresConhecidos();
        if (lista.length) {
          monitores = lista.map((m) => ({
            id: m.id,
            numero: m.numero,
            rotulo: m.rotulo,
            left: Math.round(m.left),
            top: Math.round(m.top),
            width: Math.round(m.width),
            height: Math.round(m.height),
            principal: m.principal,
          }));
          monitorNumero =
            monitorDaPosicao(
              lista,
              window.screenX,
              window.screenY,
              window.outerWidth,
              window.outerHeight,
            )?.numero ?? null;
        }
      }
    } catch {
      // sem permissão: o Monitoramento mostra apenas o aviso
    }

    // o horário é carimbado pelo banco (gatilho): o relógio do computador do
    // usuário pode estar atrasado e faria a tela sumir do Monitoramento
    const registro: Record<string, unknown> = {
      user_id: userId,
      sessao,
      rota: r,
      cliente_id: c || null,
      layout_id: l,
    };
    if (monitores) {
      registro["monitores"] = monitores;
      registro["monitor_numero"] = monitorNumero;
    }
    const { error: erroUpsert } = await (
      supabase.from("sessoes_usuario") as unknown as {
        upsert: (
          valores: Record<string, unknown>,
          opcoes: { onConflict: string },
        ) => Promise<{ error: { message: string } | null }>;
      }
    ).upsert(registro, { onConflict: "user_id,sessao" });
    if (erroUpsert && monitores) {
      // banco ainda sem as colunas de monitores: mantém o comportamento antigo
      delete registro["monitores"];
      delete registro["monitor_numero"];
      await (
        supabase.from("sessoes_usuario") as unknown as {
          upsert: (
            valores: Record<string, unknown>,
            opcoes: { onConflict: string },
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).upsert(registro, { onConflict: "user_id,sessao" });
    }
    // limpa telas do próprio usuário que não dão mais sinal (janela fechada
    // sem aviso, navegador encerrado, computador desligado). A conta é feita
    // no servidor para uma máquina nunca apagar a sessão de outra.
    const chamarRpc = (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>;
      }
    ).rpc;
    const { error } = await chamarRpc.call(supabase, "limpar_sessoes_vencidas", {
      segundos: Math.round(VENCIMENTO_MS / 1000),
    });
    if (error) {
      // banco ainda sem a função: mantém o comportamento antigo
      await supabase
        .from("sessoes_usuario")
        .delete()
        .eq("user_id", userId)
        .lt("visto_em", new Date(Date.now() - VENCIMENTO_MS * 2).toISOString());
    }
  }, [userId, sessao]);

  // ao abrir qualquer janela: se o navegador já autorizou, reconhece os
  // monitores uma vez e compartilha a lista com as demais janelas
  useEffect(() => {
    if (!userId) return;
    void garantirMonitoresDetectados().then(async () => {
      void publicar();
      if (!janelaPrincipal || !suportaMonitores() || (await monitoresAutorizados())) return;
      toast.info("Libere o gerenciamento de janelas para identificar todos os monitores.", {
        duration: 15_000,
        action: {
          label: "Liberar agora",
          onClick: () => {
            void listarMonitores(true).then((lista) => {
              if (lista.length) {
                toast.success(`${lista.length} monitor${lista.length === 1 ? "" : "es"} liberado${lista.length === 1 ? "" : "s"}.`);
                void publicar();
              } else {
                toast.error("O navegador não liberou os monitores. Use o cadeado ao lado do endereço.");
              }
            });
          },
        },
      });
    });
  }, [userId, publicar, janelaPrincipal]);

  // prévia do mosaico: a cada 30s monta uma imagem pequena com as câmeras
  // visíveis nesta janela (só o conteúdo do Sentinela, sem pedir permissão)
  useEffect(() => {
    if (!userId) return;
    const capturar = async () => {
      if (!window.location.pathname.startsWith("/visualizacao")) return;
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const largura = 400;
      const escala = largura / vw;
      const tela = document.createElement("canvas");
      tela.width = largura;
      tela.height = Math.max(1, Math.round(vh * escala));
      const ctx = tela.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, tela.width, tela.height);
      const fontes = document.querySelectorAll<HTMLVideoElement | HTMLCanvasElement>("video, canvas");
      fontes.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20 || r.bottom < 0 || r.top > vh) return;
        if (el instanceof HTMLVideoElement && (el.readyState < 2 || !el.videoWidth)) return;
        if (el instanceof HTMLCanvasElement && (!el.width || !el.height)) return;
        try {
          ctx.drawImage(el, r.left * escala, r.top * escala, r.width * escala, r.height * escala);
        } catch {
          // quadro indisponível
        }
      });
      let previa: string;
      try {
        previa = tela.toDataURL("image/jpeg", 0.55);
      } catch {
        return;
      }
      await (supabase.from("sessoes_usuario") as unknown as {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<unknown> };
        };
      })
        .update({ previa, previa_em: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("sessao", sessao);
    };
    const primeira = window.setTimeout(() => void capturar(), 5_000);
    const t = window.setInterval(() => void capturar(), 30_000);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [userId, sessao]);

  // heartbeat: a cada mudança relevante e periodicamente
  useEffect(() => {
    if (!userId) return;
    void publicar();
    const t = setInterval(() => void publicar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [userId, publicar, rota, clienteId, layoutAtual]);

  // remove a sessão ao fechar a aba (o pedido precisa sobreviver ao
  // fechamento da janela: por isso vai como `keepalive`, e não pelo cliente
  // comum, que é cancelado quando a página morre)
  useEffect(() => {
    if (!userId) return;
    const sair = () => {
      const cli = supabase as unknown as { supabaseUrl: string; supabaseKey: string };
      const url = `${cli.supabaseUrl}/rest/v1/sessoes_usuario?user_id=eq.${encodeURIComponent(
        userId,
      )}&sessao=eq.${encodeURIComponent(sessao)}`;
      const token = tokenRef.current;
      try {
        void fetch(url, {
          method: "DELETE",
          keepalive: true,
          headers: {
            apikey: cli.supabaseKey,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }).catch(() => {});
      } catch {
        /* a limpeza por tempo cuida do resto */
      }
    };
    window.addEventListener("pagehide", sair);
    window.addEventListener("beforeunload", sair);
    return () => {
      window.removeEventListener("pagehide", sair);
      window.removeEventListener("beforeunload", sair);
      sair();
    };
  }, [userId, sessao]);

  // recebe comandos do supervisor em tempo real
  useEffect(() => {
    if (!userId) return;
    const receber = (linha: {
      id?: string;
      sessao: string;
      layout_forcado: string | null;
      forcado_em: string | null;
      identificar_em: string | null;
      identificar_rotulo: string | null;
      abrir_telas?: { id?: string; telas?: TelaExtra[] } | null;
      abrir_telas_em?: string | null;
    }) => {
      if (linha.sessao !== sessao) return;
      if (janelaPrincipal && linha.id && linha.abrir_telas?.id && linha.abrir_telas_em) {
        const idade = Date.now() - new Date(linha.abrir_telas_em).getTime();
        const telas = linha.abrir_telas.telas;
        if (idade >= -10_000 && idade <= 10 * 60_000 && Array.isArray(telas) && telas.length) {
          setSolicitacaoTelas({ id: linha.abrir_telas.id, em: linha.abrir_telas_em, sessaoId: linha.id, telas });
        }
      }
      if (linha.identificar_em && linha.identificar_em !== ultimaIdentificacaoEm.current) {
        const em = linha.identificar_em;
        ultimaIdentificacaoEm.current = em;
        const enviadoHa = Date.now() - new Date(em).getTime();
         if (enviadoHa >= 0 && enviadoHa <= 10_000) {
           if (linha.identificar_rotulo === "todos-os-monitores" && janelaPrincipal) {
             void mostrarTodosOsMonitores();
           } else {
             void mostrarIdentificacao(em);
           }
         }
      }
      if (!linha.layout_forcado || !linha.forcado_em) return;
      const idade = Date.now() - new Date(linha.forcado_em).getTime();
      if (!(idade >= -10_000 && idade <= 60_000)) return;
      setLayoutForcado((prev) =>
        prev && prev.em === linha.forcado_em
          ? prev
          : { id: linha.layout_forcado as string, em: linha.forcado_em as string },
      );
    };
    const canal = supabase
      .channel(`presenca:${userId}:${sessao}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessoes_usuario",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          receber(payload.new as {
            id?: string;
            sessao: string;
            layout_forcado: string | null;
            forcado_em: string | null;
            identificar_em: string | null;
            identificar_rotulo: string | null;
            abrir_telas?: { id?: string; telas?: TelaExtra[] } | null;
            abrir_telas_em?: string | null;
          });
        },
      )
      .subscribe();
    if (janelaPrincipal) {
      void (supabase.from("sessoes_usuario") as unknown as {
        select: (campos: string) => {
          eq: (campo: string, valor: string) => {
            eq: (campo: string, valor: string) => {
              maybeSingle: () => Promise<{ data: Parameters<typeof receber>[0] | null }>;
            };
          };
        };
      }).select("id,sessao,layout_forcado,forcado_em,identificar_em,identificar_rotulo,abrir_telas,abrir_telas_em")
        .eq("user_id", userId).eq("sessao", sessao).maybeSingle().then(({ data }) => data && receber(data));
    }
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [userId, sessao, janelaPrincipal, mostrarIdentificacao, mostrarTodosOsMonitores]);

  // usa a mesma duração da identificação local dos monitores
  useEffect(() => {
    if (!identificacao) return;
    const t = setTimeout(() => setIdentificacao(null), 6000);
    return () => clearTimeout(t);
  }, [identificacao]);

  return (
    <PresencaContext.Provider value={{ setLayoutAtual, layoutForcado }}>
      {children}
      {identificacao && (
        <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center overflow-hidden p-4">
          <div className="animate-in fade-in zoom-in flex min-h-72 w-full max-w-[420px] flex-col items-center justify-center rounded-md bg-foreground px-8 py-7 text-center text-background shadow-2xl duration-300">
            <strong className="block text-9xl font-bold leading-[0.85]">
              {identificacao.numero ?? "—"}
            </strong>
            <p className="mt-7 text-2xl font-semibold">
              {identificacao.numero ? `Monitor ${identificacao.numero}` : "Este monitor"}
            </p>
            <p className="mt-2 text-sm text-background/65">
              {identificacao.total
                ? `${identificacao.total} monitor${identificacao.total === 1 ? "" : "es"} detectado${identificacao.total === 1 ? "" : "s"}`
                : "Identificação do monitor"}
            </p>
          </div>
        </div>
      )}
      <AlertDialog open={!!solicitacaoTelas}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir mosaicos nos monitores?</AlertDialogTitle>
            <AlertDialogDescription>
              O monitoramento solicitou a abertura de {solicitacaoTelas?.telas.length ?? 0} tela(s).
              {contagemAbertura != null
                ? ` Abrindo automaticamente em ${contagemAbertura} segundo${contagemAbertura === 1 ? "" : "s"}. Clique em "Agora não" para recusar.`
                : " Um clique é necessário para o navegador liberar as janelas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" onClick={() => { if (solicitacaoTelas) { void limparSolicitacao(solicitacaoTelas); setSolicitacaoTelas(null); setContagemAbertura(null); } }}>
                Agora não
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={() => solicitacaoTelas && abrirTelasSolicitadas(solicitacaoTelas)}>
                Abrir agora{contagemAbertura != null ? ` (${contagemAbertura})` : ""}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PresencaContext.Provider>
  );
}

export const usePresenca = () => useContext(PresencaContext);

/**
 * Registra o layout em uso nesta tela e aplica o layout enviado por um
 * supervisor pela tela de Monitoramento.
 */
export function useLayoutSincronizado(
  layoutId: string | null,
  aplicar: (id: string) => boolean | void,
  pronto = true,
) {
  const { setLayoutAtual, layoutForcado } = usePresenca();
  const aplicado = useRef<string | null>(null);
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  useEffect(() => {
    setLayoutAtual(layoutId);
  }, [layoutId, setLayoutAtual]);

  useEffect(() => {
    if (!layoutForcado || !pronto) return;
    if (aplicado.current === layoutForcado.em) return;
    // só marca como aplicado quando o mosaico foi de fato colocado na tela
    if (aplicarRef.current(layoutForcado.id) !== false) {
      aplicado.current = layoutForcado.em;
    }
  }, [layoutForcado, pronto]);
}
