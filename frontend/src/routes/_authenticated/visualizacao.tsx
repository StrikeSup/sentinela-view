import {
  RotacaoDeteccao,
  chaveCamera,
  EVENTO_PRIMEIRO_QUADRO,
  type DetalhePrimeiroQuadro,
  type EstadoRotacao,
} from "@/lib/rotacao-deteccao";
import { apresentarRotacaoDeteccao } from "@/lib/rotacao-deteccao-apresentacao";
import { resumirAberturaLayout } from "@/lib/abertura-layout";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { clientesQuery, dvrsQuery, servidoresQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { useLayoutSincronizado } from "@/lib/presenca";
import { registrarAtividade } from "@/lib/monitoramento.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboSelect } from "@/components/ComboSelect";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";
import { LayoutCameraSelector, type LayoutCameraSlot } from "@/components/LayoutCameraSelector";
import {
  Plus,
  Save,
  Trash2,
  Camera,
  GripVertical,
  X,
  Link2,
  Maximize2,
  AppWindow,
  Monitor,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  abrirTela,
  janelaDaTela,
  registrarTelaViva,
  lerTelasVivas,
  ouvirPresencaTelas,
  telaEstaViva,
  telaRespondendo,
  layoutDaTelaViva,
  gravarTelas,
  lerTelas,
  paramsDaTela,
  salvarTela,
  removerTela,
  enviarLayoutParaTela,
  ouvirLayoutDaTela,
  suportaMonitores,
  monitoresAutorizados,
  listarMonitores,
  monitorDaPosicao,
  encontrarMonitor,
  entrarEmTelaCheia,
  posicionarNoMonitor,
  salvarTelaRemota,
  removerTelaRemota,
  removerTelasRemotas,
  consolidarTelas,
  guardarLayoutCache,
  lerLayoutCache,
  type MonitorInfo,
  type TelaExtra,
} from "@/lib/telas-extras";
import {
  MOSAICOS,
  codificarCustom,
  decodificarCustom,
  estiloCelula,
  limiteAuto,
  mosaicoAdaptado,
  mosaicoAutomatico,
  mosaicoDe,
  type Celula,
  type Mosaico,
} from "@/lib/mosaicos";

import { CameraAoVivo } from "@/components/CameraAoVivo";

export const Route = createFileRoute("/_authenticated/visualizacao")({
  head: () => ({
    meta: [
      { title: "Visualização — Sentinela VIEW" },
      { name: "description", content: "Imagens ao vivo dos DVRs em layouts personalizáveis." },
      { property: "og:title", content: "Visualização — Sentinela VIEW" },
      { property: "og:description", content: "Câmeras ao vivo em mosaico." },
    ],
  }),
  component: VisualizacaoPage,
});

type Slot = { dvr_id: string; canal: number; url?: string } | null;
type Layout = {
  id: string;
  nome: string;
  colunas: number;
  linhas: number;
  slots: Slot[];
  criado_por: string | null;
  cliente_id: string | null;
  template: string | null;
};
type RondaResumo = { id: string; nome: string; cliente_id: string | null };
type LayoutDeteccaoResumo = {
  id: string;
  nome: string;
  cliente_id: string | null;
  template: string | null;
  retencao_segundos: number | null;
};

const DND_TYPE = "application/x-sentinela-camera";

function normalizarSlots(slots: unknown, total: number): Slot[] {
  const arr = Array.isArray(slots) ? (slots as Slot[]) : [];
  const out: Slot[] = [];
  for (let i = 0; i < total; i++) out.push(arr[i] ?? null);
  return out;
}

function VisualizacaoPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const podeVerRonda = can("ronda.ver");
  const podeVerDeteccao = can("deteccao.ver");
  // ---- telas extras (janelas separadas, uma por monitor) ----
  const telaExtra = useMemo(() => paramsDaTela(), []);
  const dvrs = useQuery(dvrsQuery);
  const layouts = useQuery({
    queryKey: ["layouts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("layouts_visualizacao").select("*").order("nome");
      if (error) throw error;
      return data as unknown as Layout[];
    },
  });
  const rondas = useQuery({
    queryKey: ["rondas"],
    enabled: podeVerRonda,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rondas")
        .select("id, nome, cliente_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as RondaResumo[];
    },
  });
  const layoutsDeteccao = useQuery({
    queryKey: ["layouts-deteccao-todos"],
    enabled: podeVerDeteccao,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_deteccao" as never)
        .select("id, nome, cliente_id, template, retencao_segundos")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LayoutDeteccaoResumo[];
    },
  });

  // Tela extra: busca só o mosaico dela (bem mais rápido que a lista inteira)
  // e já desenha a grade com o que ficou guardado da última vez.
  const layoutInicial = useMemo(
    () => (telaExtra ? lerLayoutCache<Layout>(telaExtra.layoutId) : null),
    [telaExtra],
  );
  const layoutDaTela = useQuery({
    queryKey: ["layout", telaExtra?.layoutId ?? null],
    enabled: Boolean(telaExtra?.layoutId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .select("*")
        .eq("id", telaExtra?.layoutId ?? "")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Layout) ?? null;
    },
    ...(layoutInicial ? { initialData: layoutInicial } : {}),
  });

  const clientes = useQuery(clientesQuery);
  const servidores = useQuery({
    ...servidoresQuery,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const { clienteId, setClienteId, bloqueado: clienteFixo } = useClienteSelecionado();

  const layoutsDoCliente = useMemo(
    () => (layouts.data ?? []).filter((l) => l.cliente_id === clienteId),
    [layouts.data, clienteId],
  );
  const rondasDoCliente = useMemo(
    () => (rondas.data ?? []).filter((r) => r.cliente_id === clienteId),
    [rondas.data, clienteId],
  );
  const layoutsDeteccaoDoCliente = useMemo(
    () => (layoutsDeteccao.data ?? []).filter((l) => l.cliente_id === clienteId),
    [layoutsDeteccao.data, clienteId],
  );
  const dvrsDoCliente = useMemo(
    () =>
      (dvrs.data ?? [])
        .filter((d) => d.cliente_id === clienteId)
        .map((d) => ({
          id: d.id,
          nome: d.nome,
          canais: d.canais,
          servidor:
            (servidores.data ?? []).find((s) => s.id === d.servidor_id)?.nome ?? "Sem servidor",
        })),
    [dvrs.data, servidores.data, clienteId],
  );

  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [deteccaoId, setDeteccaoId] = useState<string | null>(null);
  const [rondaId, setRondaId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sujo, setSujo] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [editSlot, setEditSlot] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [camCheia, setCamCheia] = useState<Slot>(null);
  // Ao ampliar uma câmera, as demais continuam conectadas por 20s para o retorno
  // ao mosaico ser instantâneo. Passado esse tempo, elas são desligadas como antes.
  const [manterFundo, setManterFundo] = useState(false);
  const [painelAberto, setPainelAberto] = useState(true);

  const opcaoSelecionada = rondaId
    ? `ronda:${rondaId}`
    : deteccaoId
      ? `deteccao:${deteccaoId}`
      : layoutId
        ? `layout:${layoutId}`
        : "";
  const opcoesDeVisualizacao = useMemo(
    () => [
      ...layoutsDoCliente.map((layout) => ({
        value: `layout:${layout.id}`,
        label: `${layout.nome} · ${mosaicoDe(layout.template, layout.colunas, layout.linhas).nome}`,
        hint: "Layout",
      })),
      ...(podeVerRonda
        ? rondasDoCliente.map((ronda) => ({
            value: `ronda:${ronda.id}`,
            label: ronda.nome,
            hint: "Ronda",
          }))
        : []),
      ...(podeVerDeteccao
        ? layoutsDeteccaoDoCliente.map((deteccao) => ({
            value: `deteccao:${deteccao.id}`,
            label: deteccao.nome,
            hint: "Detecção",
          }))
        : []),
    ],
    [layoutsDoCliente, podeVerRonda, rondasDoCliente, podeVerDeteccao, layoutsDeteccaoDoCliente],
  );

  const deteccaoSelecionada =
    layoutsDeteccaoDoCliente.find((item) => item.id === deteccaoId) ?? null;
  const layoutsDaDeteccao = useMemo(() => {
    try {
      const ids = JSON.parse(deteccaoSelecionada?.template ?? "[]") as unknown;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }, [deteccaoSelecionada?.template]);
  const rotacaoRef = useRef<RotacaoDeteccao | null>(null);
  const registrar = useCallback((texto: string) => {
    console.info("[detecção]", `${new Date().toLocaleTimeString("pt-BR")} ${texto}`);
  }, []);
  // Bolinha: mostra a câmera da troca pendente (no máximo uma).
  const [filaBolinha, setFilaBolinha] = useState<string[]>([]);
  const [estadoRotacao, setEstadoRotacao] = useState<EstadoRotacao | null>(null);
  const nomeDvrRef = useRef<(id: string) => string>((id) => id.slice(0, 8));

  // Detecção: ao selecionar, já mostra o primeiro layout mesmo sem movimento
  const primeiroLayoutDeteccao = layoutsDaDeteccao[0] ?? null;
  const primeiroLayoutRef = useRef<string | null>(null);
  primeiroLayoutRef.current = primeiroLayoutDeteccao;
  useEffect(() => {
    if (deteccaoId && primeiroLayoutDeteccao) setLayoutId(primeiroLayoutDeteccao);
  }, [deteccaoId, primeiroLayoutDeteccao]);

  // Ronda: ao selecionar, inicia automaticamente com as regras da ronda
  const rondaItens = useQuery({
    queryKey: ["rondas_itens", rondaId],
    enabled: !!rondaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rondas_itens")
        .select("layout_id, ordem, segundos")
        .eq("ronda_id", rondaId!)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as {
        layout_id: string;
        ordem: number;
        segundos: number | null;
      }[];
    },
  });
  const [rondaPasso, setRondaPasso] = useState(0);
  useEffect(() => setRondaPasso(0), [rondaId]);
  useEffect(() => {
    const lista = rondaItens.data ?? [];
    if (!rondaId || !lista.length) return;
    const passo = rondaPasso % lista.length;
    const item = lista[passo];
    if (!item) return;
    setLayoutId(item.layout_id);
    if (lista.length < 2) return;
    const segundos = Math.max(3, item.segundos || 15);
    const t = window.setTimeout(
      () => setRondaPasso((p) => (p + 1) % lista.length),
      segundos * 1000,
    );
    return () => window.clearTimeout(t);
  }, [rondaId, rondaPasso, rondaItens.data]);

  useEffect(() => {
    // só escuta movimento quando um Layout de detecção está selecionado
    // (layout comum e ronda nunca trocam por detecção)
    if (rondaId || !deteccaoId || !clienteId || !layoutsDaDeteccao.length) return;
    const nomeLayout = (id: string) =>
      (layouts.data ?? []).find((l) => l.id === id)?.nome ?? id.slice(0, 8);
    // A retenção configurada no Layout de detecção manda: 0 (ou ausência)
    // abre o próximo mosaico imediatamente; valores maiores valem o tempo cheio.
    const retencaoBruta = Number(deteccaoSelecionada?.retencao_segundos);
    const retencao = Number.isFinite(retencaoBruta) && retencaoBruta > 0 ? retencaoBruta : 0;
    registrar(`escutando ${layoutsDaDeteccao.length} layouts · retenção ${retencao} s`);

    let camPendente = "";
    // Somente as câmeras que o mosaico realmente desenha (mesmo corte do
    // carregamento dos slots): sem posições excedentes nem links externos.
    const camerasDo = (candidatoId: string): Slot[] => {
      const layout = (layouts.data ?? []).find((opcao) => opcao.id === candidatoId);
      if (!layout) return [];
      const base = Array.isArray(layout.slots) ? (layout.slots as Slot[]) : [];
      const lim = limiteAuto(layout.template);
      return lim
        ? base.filter(Boolean).slice(0, lim)
        : normalizarSlots(
            base,
            mosaicoDe(layout.template, layout.colunas, layout.linhas).celulas.length,
          );
    };
    const rotacao = new RotacaoDeteccao({
      retencaoMs: retencao * 1000,
      camerasDe: (id) =>
        camerasDo(id)
          .filter((c) => c && !c.url?.trim() && c.dvr_id && Number.isFinite(c.canal) && c.canal > 0)
          .map((c) => chaveCamera(c!.dvr_id, c!.canal)),
      abrir: (id) => {
        registrar(`ABRINDO ${nomeLayout(id)} — aguardando primeiro quadro`);
        setLayoutId(id);
      },
      aoMudar: (e) => {
        setFilaBolinha(e.pendente ? [camPendente] : []);
        setEstadoRotacao(e);
        if (e.falha)
          registrar(
            `${nomeLayout(e.atual ?? "")}: ${e.faltantes.length}/${e.total} câmera(s) sem quadro no prazo`,
          );
      },
    });
    rotacao.definirAtual(primeiroLayoutRef.current);
    rotacaoRef.current = rotacao;
    const aoQuadro = (ev: Event) => {
      const d = (ev as CustomEvent<DetalhePrimeiroQuadro>).detail;
      if (d?.dvrId) rotacao.primeiroQuadro(chaveCamera(d.dvrId, d.canal));
    };
    window.addEventListener(EVENTO_PRIMEIRO_QUADRO, aoQuadro);

    const receberMovimento = (evento: { dvr_id?: string; canal?: number }) => {
      if (!evento.dvr_id || !Number.isFinite(evento.canal)) return;
      const cam = `${nomeDvrRef.current(evento.dvr_id)} CH${evento.canal}`;
      // 1º: layout com a própria câmera; 2º: layout com qualquer câmera do mesmo DVR
      const layoutEncontradoId =
        layoutsDaDeteccao.find((id) =>
          camerasDo(id).some(
            (camera) => camera?.dvr_id === evento.dvr_id && camera?.canal === evento.canal,
          ),
        ) ??
        layoutsDaDeteccao.find((id) =>
          camerasDo(id).some((camera) => camera?.dvr_id === evento.dvr_id),
        );
      if (!layoutEncontradoId) return;
      const antes = rotacao.estado().pendente;
      if (layoutEncontradoId !== antes) camPendente = cam;
      const r = rotacao.evento(layoutEncontradoId);
      if (r === "pendente" || r === "abrindo")
        registrar(`${cam}: ${nomeLayout(layoutEncontradoId)} ${r}`);
      if (r === "pendente") setFilaBolinha([cam]);
    };

    // Nome único por montagem: reaproveitar o mesmo nome enquanto o canal
    // anterior ainda está sendo removido deixava a escuta "morta" sem aviso.
    let encerrado = false;
    let religar: number | null = null;
    let canal: ReturnType<typeof supabase.channel> | null = null;
    const conectar = () => {
      if (encerrado) return;
      const novo = supabase
        .channel(`visualizacao-deteccao:${deteccaoId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "eventos_deteccao",
            filter: `cliente_id=eq.${clienteId}`,
          },
          (payload) => {
            const ev = payload.new as { dvr_id?: string; canal?: number; tipo?: string };
            if (ev.tipo === "portao_fechado") return;
            receberMovimento(ev);
          },
        )
        .subscribe((status) => {
          registrar(`conexão de eventos: ${status}`);
          if (
            !encerrado &&
            novo === canal &&
            (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          ) {
            // Reconecta sozinho em quedas transitórias da conexão em tempo real
            canal = null;
            void supabase.removeChannel(novo);
            if (religar === null)
              religar = window.setTimeout(() => {
                religar = null;
                conectar();
              }, 2000);
          }
        });
      canal = novo;
    };
    conectar();

    return () => {
      encerrado = true;
      if (religar !== null) window.clearTimeout(religar);
      rotacao.encerrar();
      rotacaoRef.current = null;
      window.removeEventListener(EVENTO_PRIMEIRO_QUADRO, aoQuadro);
      setFilaBolinha([]);
      setEstadoRotacao(null);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [
    clienteId,
    deteccaoId,
    rondaId,
    layoutsDaDeteccao,
    deteccaoSelecionada?.retencao_segundos,
    layouts.data,
    registrar,
  ]);

  // Borda verde só quando a tela roda um Layout de detecção; fica acesa
  // pelo tempo de retenção configurado (6 s quando não há retenção).
  const [camerasComMovimento, setCamerasComMovimento] = useState<Set<string>>(new Set());
  const deteccaoAtiva = Boolean(deteccaoId && !rondaId);
  const retencaoBordaS = Number(deteccaoSelecionada?.retencao_segundos);
  const duracaoBordaMs =
    Number.isFinite(retencaoBordaS) && retencaoBordaS > 0 ? retencaoBordaS * 1000 : 6000;
  useEffect(() => {
    if (!clienteId || !deteccaoAtiva) {
      setCamerasComMovimento(new Set());
      return;
    }
    const timers = new Map<string, number>();
    const canal = supabase
      .channel(`visualizacao-borda:${clienteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eventos_deteccao",
          filter: `cliente_id=eq.${clienteId}`,
        },
        (payload) => {
          const e = payload.new as { dvr_id?: string; canal?: number; tipo?: string };
          if (e.tipo === "portao_fechado") return;
          if (!e.dvr_id || !Number.isFinite(e.canal)) return;
          const chave = `${e.dvr_id}:${e.canal}`;
          setCamerasComMovimento((v) => (v.has(chave) ? v : new Set(v).add(chave)));
          const antigo = timers.get(chave);
          if (antigo) window.clearTimeout(antigo);
          timers.set(
            chave,
            window.setTimeout(() => {
              timers.delete(chave);
              setCamerasComMovimento((v) => {
                const n = new Set(v);
                n.delete(chave);
                return n;
              });
            }, duracaoBordaMs),
          );
        },
      )
      .subscribe();
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      setCamerasComMovimento(new Set());
      void supabase.removeChannel(canal);
    };
  }, [clienteId, deteccaoAtiva, duracaoBordaMs]);

  // tela extra: só memoriza a posição depois de chegar ao monitor certo
  const [posicionada, setPosicionada] = useState(false);
  const [monitorAlvo, setMonitorAlvo] = useState<MonitorInfo | null>(null);
  const [monitorAtual, setMonitorAtual] = useState<MonitorInfo | null>(null);
  const [mostrarMonitor, setMostrarMonitor] = useState(false);
  const janelas = useRef<Record<string, Window | null>>({});
  const abrindoTela = useRef(false);
  const [telas, setTelas] = useState<TelaExtra[]>([]);
  const [monitores, setMonitores] = useState<MonitorInfo[]>([]);

  // se o usuário já autorizou antes, carrega os monitores sem pedir de novo
  useEffect(() => {
    if (telaExtra) return;
    let ativo = true;
    void (async () => {
      if (!(await monitoresAutorizados())) return;
      const lista = await listarMonitores();
      if (ativo) setMonitores(lista);
    })();
    return () => {
      ativo = false;
    };
  }, [telaExtra]);

  const monitorDaTela = useCallback(
    (t: { left: number; top: number; width: number; height: number }) =>
      monitorDaPosicao(monitores, t.left, t.top, t.width, t.height),
    [monitores],
  );

  const sincronizarTelas = useCallback(() => {
    const porId = new Map(lerTelas().map((t) => [t.id, t]));
    // Uma tela viva é a fonte mais recente. Essa união recupera janelas mesmo
    // se outra aba tiver gravado uma versão antiga da lista compartilhada.
    for (const tela of lerTelasVivas()) porId.set(tela.id, tela);
    const lista = Array.from(porId.values()).map((t) => {
      const m = monitorDaPosicao(monitores, t.left, t.top, t.width, t.height);
      return m ? { ...t, monitorId: m.id } : t;
    });
    // A própria tela também publica presença. Isso permite detectá-la mesmo
    // depois de recarregar a tela principal, quando a referência foi perdida.
    const vivas = lista.filter((t) => {
      const w = janelas.current[t.id] ?? janelaDaTela(t.id);
      if ((!w || w.closed) && !telaRespondendo(t.id)) {
        delete janelas.current[t.id];
        return false;
      }
      if (w && !w.closed) janelas.current[t.id] = w;
      return true;
    });
    // o painel mostra o mosaico que cada tela realmente está exibindo
    const comMosaico = vivas.map((t) => {
      const emUso = layoutDaTelaViva(t.id);
      return emUso && emUso !== t.layoutId ? { ...t, layoutId: emUso } : t;
    });
    // a memória das telas (para reabrir no próximo acesso) continua intacta
    gravarTelas(lista);
    setTelas(comMosaico);
  }, [monitores]);

  // dentro de uma janela extra: aplica o mosaico inicial UMA única vez.
  // Reaplicar depois faria a tela voltar ao mosaico da abertura sempre que
  // a janela recebesse foco novamente.
  const inicialAplicado = useRef(false);
  useEffect(() => {
    if (!telaExtra || inicialAplicado.current) return;
    inicialAplicado.current = true;
    if (telaExtra.clienteId && !clienteFixo) setClienteId(telaExtra.clienteId);
    if (telaExtra.layoutId) setLayoutId(telaExtra.layoutId);
  }, [telaExtra, clienteFixo, setClienteId]);

  // tela extra: recebe troca de layout enviada pela janela principal
  useEffect(() => {
    if (!telaExtra) return;
    return ouvirLayoutDaTela(telaExtra.id, ({ layoutId: novo, clienteId: cli }) => {
      if (cli && !clienteFixo) setClienteId(cli);
      if (!novo) return;
      setLayoutId(novo);
      // grava na hora, para a gravação periódica não regravar o mosaico antigo
      const atual = lerTelas().find((t) => t.id === telaExtra.id);
      const tela: TelaExtra = {
        ...(atual ?? {
          id: telaExtra.id,
          clienteId: cli ?? telaExtra.clienteId,
          left: window.screenX,
          top: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
          monitorId: telaExtra.monitorId,
          telaCheia: telaExtra.telaCheia,
        }),
        layoutId: novo,
        ...(cli ? { clienteId: cli } : {}),
      };
      salvarTela(tela);
      if (user?.id) void salvarTelaRemota(user.id, tela, true);
    });
  }, [telaExtra, clienteFixo, setClienteId, user?.id]);

  // janela principal: mantém a lista de telas em dia
  useEffect(() => {
    if (telaExtra) return;
    sincronizarTelas();
    const t = setInterval(sincronizarTelas, 2000);
    const pararPresenca = ouvirPresencaTelas(sincronizarTelas);
    const aoFocar = () => sincronizarTelas();
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoFocar);
    return () => {
      clearInterval(t);
      pararPresenca();
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoFocar);
    };
  }, [telaExtra, sincronizarTelas]);

  // a tela extra publica presença informando o mosaico que está exibindo
  const layoutAtualRef = useRef<string | null>(null);
  layoutAtualRef.current = layoutId;
  useEffect(() => {
    if (!telaExtra) return;
    return registrarTelaViva(telaExtra.id, () => {
      const atual = lerTelas().find((t) => t.id === telaExtra.id);
      return {
        ...(atual ?? {
          id: telaExtra.id,
          clienteId: telaExtra.clienteId,
          left: window.screenX,
          top: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
          monitorId: telaExtra.monitorId,
          telaCheia: telaExtra.telaCheia,
        }),
        layoutId: layoutAtualRef.current ?? atual?.layoutId ?? telaExtra.layoutId,
        clienteId: clienteId || atual?.clienteId || telaExtra.clienteId,
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      };
    });
  }, [telaExtra, clienteId]);

  // a janela extra se muda sozinha para o monitor guardado (o navegador
  // costuma abri-la em cima da janela principal)
  useEffect(() => {
    if (!telaExtra) return;
    let ativo = true;
    void (async () => {
      const alvo = await posicionarNoMonitor();
      if (!ativo) return;
      setMonitorAlvo(alvo);
      setPosicionada(true);
      setMostrarMonitor(true);
    })();
    return () => {
      ativo = false;
    };
  }, [telaExtra]);

  useEffect(() => {
    if (!telaExtra || !posicionada) return;
    // a própria janela extra reconhece em qual monitor está, para voltar nele
    let meusMonitores: MonitorInfo[] = [];
    let ativo = true;
    const detectarMonitorAtual = () => {
      const monitor = monitorDaPosicao(
        meusMonitores,
        window.screenX,
        window.screenY,
        window.outerWidth,
        window.outerHeight,
      );
      if (ativo) {
        setMonitorAtual((anterior) => {
          if (anterior?.id === monitor?.id) return anterior;
          // monitor mudou → mostra o rótulo temporariamente
          if (anterior && monitor) setMostrarMonitor(true);
          return monitor;
        });
      }
      return monitor;
    };
    void (async () => {
      if (await monitoresAutorizados()) {
        meusMonitores = await listarMonitores();
        detectarMonitorAtual();
      }
    })();
    const gravar = () => {
      const left = window.screenX;
      const top = window.screenY;
      const width = window.outerWidth;
      const height = window.outerHeight;
      const monitor = detectarMonitorAtual();
      const salvoAntes = lerTelas().find((t) => t.id === telaExtra.id)?.monitorId ?? null;
      // A tela abriu em outro monitor porque o original estava desconectado?
      // Nesse caso preserva o monitor de origem, a menos que o usuário mova a
      // janela para um monitor diferente daquele em que ela abriu.
      const abriuRealocada =
        !!telaExtra.monitorAbertura && telaExtra.monitorAbertura !== telaExtra.monitorId;
      const permanece = abriuRealocada && monitor?.id === telaExtra.monitorAbertura;
      const tela: TelaExtra = {
        id: telaExtra.id,
        layoutId: layoutId ?? telaExtra.layoutId,
        clienteId: clienteId || telaExtra.clienteId,
        left,
        top,
        width,
        height,
        monitorId: permanece
          ? telaExtra.monitorId
          : (monitor?.id ?? telaExtra.monitorId ?? salvoAntes),
        telaCheia: telaExtra.telaCheia,
      };
      salvarTela(tela);
      if (user?.id) void salvarTelaRemota(user.id, tela);
    };
    gravar();
    const detector = setInterval(detectarMonitorAtual, 500);
    const persistencia = setInterval(gravar, 3000);
    window.addEventListener("pagehide", gravar);
    return () => {
      ativo = false;
      clearInterval(detector);
      clearInterval(persistencia);
      window.removeEventListener("pagehide", gravar);
    };
  }, [telaExtra, posicionada, layoutId, clienteId, user?.id]);

  // o rótulo do monitor aparece só na abertura ou troca de monitor, some em 3 s
  useEffect(() => {
    if (!mostrarMonitor) return;
    const t = setTimeout(() => setMostrarMonitor(false), 3000);
    return () => clearTimeout(t);
  }, [mostrarMonitor]);

  const abrirNovaTela = useCallback(async () => {
    // dois cliques seguidos não podem disputar o mesmo identificador de tela
    if (abrindoTela.current) return;
    abrindoTela.current = true;
    window.setTimeout(() => {
      abrindoTela.current = false;
    }, 1200);
    // o clique é o momento certo para pedir a permissão de monitores
    let lista = monitores;
    if (!lista.length && suportaMonitores()) {
      lista = await listarMonitores();
      setMonitores(lista);
    }

    const memoria = consolidarTelas(lerTelas()).telas;
    const atual = monitorDaPosicao(
      lista,
      window.screenX,
      window.screenY,
      window.outerWidth,
      window.outerHeight,
    );
    // abre no primeiro monitor livre: nem o desta janela, nem os que já têm tela.
    // Monitores com o mesmo nome contam separadamente (cada tela ocupa o seu).
    const ocupados = new Set<string>();
    for (const t of lerTelas()) {
      const m = encontrarMonitor(lista, t.monitorId, ocupados);
      if (m) ocupados.add(m.id);
      else if (t.monitorId) ocupados.add(t.monitorId);
    }

    if (atual?.id) ocupados.add(atual.id);
    const livre =
      lista.find((m) => !ocupados.has(m.id)) ?? lista.find((m) => m.id !== atual?.id) ?? null;
    // Sem monitor livre, a tela nasce no monitor atual — mas em janela menor e
    // deslocada, para não cobrir (nem parecer que substituiu) a tela principal.
    const destino = livre ?? atual ?? null;
    const dividindo = !livre;
    // Se existe uma posição memorizada e atualmente fechada, reutiliza seu
    // identificador em vez de acumular outra "Tela 4, 5, 6..." na conta.
    const reutilizavel =
      memoria.find(
        (t) =>
          !telaEstaViva(t.id) &&
          !!destino &&
          (encontrarMonitor(lista, t.monitorId)?.id ?? t.monitorId) === destino.id,
      ) ?? memoria.find((t) => !telaEstaViva(t.id));
    const id = reutilizavel?.id ?? Math.random().toString(36).slice(2, 10);
    // com monitores reconhecidos, a tela nasce ocupando o monitor inteiro
    const width = dividindo
      ? Math.round((destino ? destino.width : 1280) * 0.6)
      : destino
        ? destino.width
        : 1280;
    const height = dividindo
      ? Math.round((destino ? destino.height : 720) * 0.6)
      : destino
        ? destino.height
        : 720;

    // Mosaico da nova tela: primeiro o que essa posição já usava, depois um
    // mosaico ainda não exibido por nenhuma janela; só por último o da principal.
    const emUso = new Set<string>();
    if (layoutId) emUso.add(layoutId);
    for (const t of lerTelas()) {
      const atual = layoutDaTelaViva(t.id) ?? t.layoutId;
      if (atual) emUso.add(atual);
    }
    const layoutNovo =
      reutilizavel?.layoutId ?? layoutsDoCliente.find((l) => !emUso.has(l.id))?.id ?? layoutId;

    // Telas já abertas neste mesmo monitor: cada nova nasce um degrau ao lado,
    // em vez de todas empilharem exatamente no mesmo lugar.
    const jaNoDestino = destino
      ? memoria.filter(
          (t) =>
            telaEstaViva(t.id) &&
            (encontrarMonitor(lista, t.monitorId)?.id ?? t.monitorId) === destino.id,
        ).length
      : 0;
    const folgaX = destino ? Math.max(0, destino.width - width) : 240;
    const folgaY = destino ? Math.max(0, destino.height - height) : 240;
    const degrauX = Math.min(60 * (jaNoDestino + 1), folgaX);
    const degrauY = Math.min(60 * (jaNoDestino + 1), folgaY);

    const tela: TelaExtra = {
      id,
      layoutId: layoutNovo,
      clienteId: clienteId || null,
      left: dividindo
        ? (destino ? destino.left : window.screenX) + degrauX
        : destino
          ? destino.left
          : window.screenX + 80,
      top: dividindo
        ? (destino ? destino.top : window.screenY) + degrauY
        : destino
          ? destino.top
          : window.screenY + 60,
      width,
      height,
      monitorId: destino?.id ?? null,
      telaCheia: !dividindo,
    };
    const w = abrirTela(tela);
    if (!w) {
      toast.error("O navegador bloqueou a nova tela. Permita janelas pop-up neste site.");
      return;
    }
    janelas.current[id] = w;
    salvarTela(tela);
    if (user?.id) void salvarTelaRemota(user.id, tela, true);
    sincronizarTelas();
    toast.success(
      dividindo
        ? "Sem monitor livre: a tela abriu em janela menor, ao lado da principal."
        : destino
          ? `Tela aberta no ${destino.rotulo}.`
          : "Tela aberta — arraste-a para o monitor desejado.",
    );
  }, [layoutId, clienteId, layoutsDoCliente, sincronizarTelas, monitores, user?.id]);

  const trocarLayoutDaTela = useCallback(
    (tela: TelaExtra, novoLayout: string) => {
      const nova = { ...tela, layoutId: novoLayout };
      salvarTela(nova);
      if (user?.id) void salvarTelaRemota(user.id, nova, true);
      enviarLayoutParaTela(tela.id, novoLayout, tela.clienteId);
      sincronizarTelas();
      {
        const nome = (layouts.data ?? []).find((l) => l.id === novoLayout)?.nome ?? "mosaico";
        void registrarAtividade({
          data: {
            descricao: `enviou o mosaico "${nome}" para a tela ${tela.id}`,
            registroId: novoLayout,
            detalhes: { tela: tela.id, mosaico: nome },
          },
        }).catch(() => {});
      }
      // A janela recém-aberta pode levar alguns segundos até aplicar e publicar
      // o mosaico. Confere por até 12 s, reenviando a ordem no começo, e só
      // avisa se ela realmente não estiver dando sinal de vida.
      let tentativas = 0;
      const timer = window.setInterval(() => {
        tentativas += 1;
        if (layoutDaTelaViva(tela.id) === novoLayout) {
          window.clearInterval(timer);
          return;
        }
        if (tentativas <= 3) enviarLayoutParaTela(tela.id, novoLayout, tela.clienteId);
        if (tentativas >= 8) {
          window.clearInterval(timer);
          if (!telaEstaViva(tela.id)) {
            toast.error("Essa tela não respondeu. Verifique se ela continua aberta.");
          }
        }
      }, 1500);
    },
    [sincronizarTelas, user?.id, layouts.data],
  );

  const fecharTela = useCallback(
    (id: string) => {
      try {
        janelas.current[id]?.close();
      } catch {
        /* ignora */
      }
      delete janelas.current[id];
      removerTela(id);
      if (user?.id) void removerTelaRemota(user.id, id);
      sincronizarTelas();
    },
    [sincronizarTelas, user?.id],
  );

  const fecharTelas = useCallback(() => {
    const ids = Object.keys(janelas.current).concat(lerTelas().map((t) => t.id));
    for (const w of Object.values(janelas.current)) {
      try {
        w?.close();
      } catch {
        /* ignora */
      }
    }
    janelas.current = {};
    for (const id of new Set(ids)) removerTela(id);
    gravarTelas([]);
    setTelas([]);
    if (user?.id) void removerTelasRemotas(user.id, Array.from(new Set(ids)));
  }, [user?.id]);

  // a reabertura das telas acontece logo após o login (componente RestaurarTelas)
  useEffect(() => {
    if (telaExtra) return;
    setTelas(lerTelas());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tela extra: entra em tela cheia no monitor
  useEffect(() => {
    if (!telaExtra?.telaCheia || !posicionada) return;
    return entrarEmTelaCheia(monitorAlvo);
  }, [telaExtra, posicionada, monitorAlvo]);

  useEffect(() => {
    if (!fullscreen && !camCheia) return;

    const sairComEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (camCheia) {
        setCamCheia(null);
        return;
      }
      setFullscreen(false);
    };

    // trava a rolagem da página atrás do mosaico em tela cheia
    const html = document.documentElement;
    const body = document.body;
    const overflowHtml = html.style.overflow;
    const overflowBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    window.addEventListener("keydown", sairComEsc);
    return () => {
      window.removeEventListener("keydown", sairComEsc);
      html.style.overflow = overflowHtml;
      body.style.overflow = overflowBody;
    };
  }, [fullscreen, camCheia]);

  // Câmera ampliada: mantém as demais conectadas por 20s (retorno instantâneo).
  useEffect(() => {
    if (!camCheia) {
      setManterFundo(false);
      return;
    }
    setManterFundo(true);
    const t = setTimeout(() => setManterFundo(false), 20000);
    return () => clearTimeout(t);
  }, [camCheia]);

  /** Entra em tela cheia do navegador junto com o modo tela cheia do mosaico. */
  const entrarTelaCheia = () => {
    setFullscreen(true);
    if (typeof document !== "undefined" && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  /** O X do canto sai da tela cheia (inclusive a do navegador). */
  const sairDaTelaCheia = () => {
    setFullscreen(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const layout = useMemo(() => {
    const daLista = (layouts.data ?? []).find((l) => l.id === layoutId) ?? null;
    if (daLista) return daLista;
    const rapido = layoutDaTela.data ?? null;
    return rapido && rapido.id === layoutId ? rapido : null;
  }, [layouts.data, layoutDaTela.data, layoutId]);

  // guarda o mosaico para a próxima abertura desenhar a grade na hora
  useEffect(() => {
    if (layout) guardarLayoutCache(layout.id, layout);
  }, [layout]);

  // registra no Log cada mosaico aberto nesta janela
  const ultimoLogado = useRef<string | null>(null);
  useEffect(() => {
    if (!layoutId || ultimoLogado.current === layoutId) return;
    const nome = (layouts.data ?? []).find((l) => l.id === layoutId)?.nome;
    if (!nome) return;
    const t = window.setTimeout(() => {
      ultimoLogado.current = layoutId;
      const onde = telaExtra ? `na tela ${telaExtra.id}` : "na tela principal";
      void registrarAtividade({
        data: {
          descricao: `abriu o mosaico "${nome}" ${onde}`,
          registroId: layoutId,
          detalhes: { mosaico: nome, tela: telaExtra?.id ?? "principal" },
        },
      }).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, [layoutId, layouts.data, telaExtra]);

  // aplica o mosaico enviado pela tela de Monitoramento
  const layoutPedido = useRef<string | null>(null);
  useLayoutSincronizado(
    layoutId,
    (id) => {
      if (!layouts.data) return false;
      const alvo = layouts.data.find((l) => l.id === id);
      if (!alvo) return false;
      layoutPedido.current = id;
      if (alvo.cliente_id && alvo.cliente_id !== clienteId && !clienteFixo) {
        setClienteId(alvo.cliente_id);
      }
      setLayoutId(id);
      toast.info(`Mosaico alterado para “${alvo.nome}”`);
      return true;
    },
    !!layouts.data,
  );

  // ao trocar de cliente, seleciona o primeiro layout dele
  useEffect(() => {
    if (!clienteId) return;
    // enquanto a lista de layouts não chegou, não mexe na escolha atual
    if (!layouts.data) return;
    // mosaico pedido pelo Monitoramento: não substitui pelo primeiro do cliente
    const pedido = layoutPedido.current;
    if (pedido) {
      const alvo = layouts.data.find((l) => l.id === pedido);
      if (alvo && (!alvo.cliente_id || alvo.cliente_id === clienteId)) {
        layoutPedido.current = null;
        if (layoutId !== pedido) setLayoutId(pedido);
        return;
      }
      if (alvo && alvo.cliente_id !== clienteId) return;
      layoutPedido.current = null;
    }
    // numa tela extra o mosaico é próprio: só troca se ele não existir mais
    if (telaExtra) {
      if (layoutId && layouts.data.some((l) => l.id === layoutId)) return;
      setLayoutId(layoutsDoCliente[0]?.id ?? null);
      return;
    }
    if (!layoutId || !layoutsDoCliente.some((l) => l.id === layoutId)) {
      setLayoutId(layoutsDoCliente[0]?.id ?? null);
    }
  }, [clienteId, layouts.data, layoutsDoCliente, layoutId, telaExtra]);

  const limite = useMemo(() => limiteAuto(layout?.template), [layout]);

  const mosaico = useMemo(
    () =>
      mosaicoAdaptado(
        layout?.template,
        layout?.colunas ?? 2,
        layout?.linhas ?? 2,
        slots.filter(Boolean).length,
        1,
      ),
    [layout, slots],
  );

  // carrega os slots quando muda de layout
  useEffect(() => {
    if (!layout) return;
    const base = Array.isArray(layout.slots) ? (layout.slots as Slot[]) : [];
    const lim = limiteAuto(layout.template);
    if (lim) {
      setSlots(base.filter(Boolean).slice(0, lim));
    } else {
      setSlots(
        normalizarSlots(
          base,
          mosaicoDe(layout.template, layout.colunas, layout.linhas).celulas.length,
        ),
      );
    }
    setSujo(false);
  }, [layout]);

  // Cada janela renova somente as câmeras do seu layout. A intenção expira
  // rapidamente quando a janela fecha, sem manter DVRs inteiros publicados.
  const janelaPreparo = useRef<string | null>(null);
  const camerasDoLayout = useMemo(
    () =>
      [
        ...new Map(
          slots
            .filter((slot): slot is NonNullable<Slot> => Boolean(slot && !slot.url))
            .map((slot) => [
              `${slot.dvr_id}:${slot.canal}`,
              { dvr_id: slot.dvr_id, canal: slot.canal },
            ]),
        ).values(),
      ].slice(0, 64),
    [slots],
  );
  const chavePreparo = camerasDoLayout.map((c) => `${c.dvr_id}:${c.canal}`).join(",");
  const [aberturaLayout, setAberturaLayout] = useState<{ chave: string; tempos: number[] }>({
    chave: "",
    tempos: [],
  });
  useEffect(() => {
    if (!layout?.id || !chavePreparo) return;
    const chave = `${layout.id}|${chavePreparo}`;
    const esperadas = new Set(camerasDoLayout.map((c) => `${c.dvr_id}:${c.canal}`));
    const medidas = new Set<string>();
    const inicio = performance.now();
    setAberturaLayout({ chave, tempos: [] });
    const aoQuadro = (evento: Event) => {
      const camera = (evento as CustomEvent<DetalhePrimeiroQuadro>).detail;
      const id = `${camera?.dvrId}:${camera?.canal}`;
      if (!esperadas.has(id) || medidas.has(id)) return;
      medidas.add(id);
      setAberturaLayout((atual) =>
        atual.chave === chave
          ? { chave, tempos: [...atual.tempos, Math.round(performance.now() - inicio)] }
          : atual,
      );
    };
    window.addEventListener(EVENTO_PRIMEIRO_QUADRO, aoQuadro);
    return () => window.removeEventListener(EVENTO_PRIMEIRO_QUADRO, aoQuadro);
  }, [layout?.id, chavePreparo, camerasDoLayout]);
  const resumoAbertura = resumirAberturaLayout(
    camerasDoLayout.length,
    aberturaLayout.chave === `${layout?.id}|${chavePreparo}` ? aberturaLayout.tempos : [],
  );
  useEffect(() => {
    if (!layout?.id || !chavePreparo) return;
    janelaPreparo.current ??= crypto.randomUUID();
    let ativo = true;
    const renovar = async () => {
      const { data } = await supabase.auth.getSession();
      if (!ativo || !data.session?.access_token) return;
      try {
        await fetch("/api/public/v1/preparar-layout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ janela_id: janelaPreparo.current, cameras: camerasDoLayout }),
        });
      } catch {
        /* o vídeo continua sob demanda quando a preparação falha */
      }
    };
    void renovar();
    const intervalo = window.setInterval(() => void renovar(), 20_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [layout?.id, chavePreparo, camerasDoLayout]);

  // Pré-carga oculta desligada: no Layout de detecção ela abria uma sessão
  // para cada câmera de todos os layouts (~100), competindo com as visíveis.
  // O layout atual continua abrindo todas as suas câmeras em paralelo.
  const camerasPreCarregadas: { dvr_id: string; canal: number }[] = [];

  const criar = useMutation({
    mutationFn: async (v: {
      nome: string;
      colunas: number;
      linhas: number;
      template: string;
      slots: LayoutCameraSlot[];
    }) => {
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .insert({
          ...v,
          slots: JSON.parse(JSON.stringify(v.slots)) as Json,
          criado_por: user?.id ?? null,
          cliente_id: clienteId || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Layout;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["layouts"] });
      setLayoutId(data.id);
      setNovoAberto(false);
      toast.success("Layout criado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!layout) return;
      const { error } = await supabase
        .from("layouts_visualizacao")
        .update({ slots: JSON.parse(JSON.stringify(slots)) as Json })
        .eq("id", layout.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layouts"] });
      setSujo(false);
      toast.success("Layout salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      if (!layout) return;
      const { error } = await supabase.from("layouts_visualizacao").delete().eq("id", layout.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layouts"] });
      setLayoutId(null);
      toast.success("Layout excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nomeDvr = (id: string) =>
    (dvrs.data ?? []).find((d) => d.id.toLowerCase() === id.toLowerCase())?.nome ?? id.slice(0, 8);
  nomeDvrRef.current = nomeDvr;
  const nomeLayoutRotacao = (id: string) =>
    (layouts.data ?? []).find((item) => item.id === id)?.nome ?? id.slice(0, 8);
  const nomeCameraRotacao = (chave: string) => {
    const separador = chave.lastIndexOf(":");
    if (separador < 0) return chave.slice(0, 12);
    const dvrId = chave.slice(0, separador);
    const canal = chave.slice(separador + 1);
    return `${nomeDvr(dvrId)} CH${canal}`;
  };
  const apresentacaoRotacao = apresentarRotacaoDeteccao(estadoRotacao, {
    nomeLayout: nomeLayoutRotacao,
    nomeCamera: nomeCameraRotacao,
  });

  // Mantém as posições vazias no meio do mosaico; só respeita o limite de posições.
  const ajustar = (lista: Slot[]) => {
    const podado = limite ? lista.slice(0, limite) : lista;
    let fim = podado.length;
    while (fim > 0 && !podado[fim - 1]) fim -= 1;
    return podado.slice(0, fim);
  };

  const atualizarSlot = (i: number, s: Slot) => {
    setSlots((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(null);
      next[i] = s;
      return ajustar(next);
    });
    setSujo(true);
  };

  const adicionarProxima = (s: NonNullable<Slot>) => {
    const teto = limite ?? mosaico.celulas.length;
    setSlots((prev) => {
      const next = [...prev];
      let idx = next.findIndex((p) => !p);
      if (idx < 0) idx = next.length;
      if (idx >= teto) {
        toast.error("O layout já está cheio.");
        return prev;
      }
      while (next.length <= idx) next.push(null);
      next[idx] = s;
      return ajustar(next);
    });
    setSujo(true);
  };

  const onDrop = (e: DragEvent, destino: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return;
    const payload = JSON.parse(raw) as { origem?: number; slot: Slot };
    setSlots((prev) => {
      const next = [...prev];
      while (next.length <= destino) next.push(null);
      if (payload.origem !== undefined) {
        // troca de posição dentro do mosaico
        const tmp = next[destino] ?? null;
        next[destino] = next[payload.origem] ?? null;
        next[payload.origem] = tmp;
      } else {
        next[destino] = payload.slot;
      }
      return ajustar(next);
    });
    setSujo(true);
  };

  const renderGrid = (fitScreen: boolean) =>
    layout && (
      <div
        className="grid h-full w-full gap-0"
        style={{
          gridTemplateColumns: `repeat(${mosaico.colunas}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${mosaico.linhas}, minmax(0, 1fr))`,
        }}
      >
        {mosaico.celulas.map((_cel, i) => {
          const s = slots[i] ?? null;
          return (
            <div
              key={i}
              onDragEnter={(e) => e.preventDefault()}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => onDrop(e, i)}
              onDoubleClick={() => s && setCamCheia(s)}
              style={mosaico.celulas[i] ? estiloCelula(mosaico.celulas[i]!) : undefined}
              className="group relative overflow-hidden bg-black/90"
            >
              {s ? (
                <CameraTile
                  slot={s}
                  nome={nomeDvr(s.dvr_id)}
                  editavel={!fullscreen && !camCheia}
                  arrastavel={!camCheia}
                  oculta={
                    Boolean(camCheia) &&
                    !manterFundo &&
                    !(camCheia && camCheia.dvr_id === s.dvr_id && camCheia.canal === s.canal)
                  }
                  movimento={camerasComMovimento.has(`${s.dvr_id}:${s.canal}`)}
                  expandida={Boolean(
                    camCheia && camCheia.dvr_id === s.dvr_id && camCheia.canal === s.canal,
                  )}
                  onFecharExpandida={() => setCamCheia(null)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ origem: i, slot: s }));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onRemover={() => atualizarSlot(i, null)}
                  onEditar={() => setEditSlot(i)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditSlot(i)}
                  onDragEnter={(e) => e.preventDefault()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => onDrop(e, i)}
                  className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground [&>*]:pointer-events-none"
                >
                  <Camera className="h-6 w-6 opacity-50" />
                  {!fullscreen && <span>Solte uma câmera aqui ou clique</span>}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );

  const grade = layout && (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-background p-2"
          : "relative h-full w-full"
      }
    >
      {resumoAbertura.total > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/70 px-2 py-1 text-[11px] text-white/90">
          Primeiro quadro: {resumoAbertura.prontas}/{resumoAbertura.total}
          {resumoAbertura.medianaMs !== null && ` · mediana ${resumoAbertura.medianaMs} ms`}
        </div>
      )}
      {fullscreen && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white/80 backdrop-blur">
            {layout.nome}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 bg-black/50 p-0 text-white hover:bg-black/70"
            title="Sair da tela cheia"
            onClick={sairDaTelaCheia}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="h-full w-full">{renderGrid(fullscreen)}</div>
      {camerasPreCarregadas.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
        >
          {camerasPreCarregadas.map((c) => (
            <div key={`${c.dvr_id}:${c.canal}`} className="absolute left-0 top-0 h-px w-px">
              <CameraAoVivo dvrId={c.dvr_id} canal={c.canal} segundoPlano qualidade="extra" />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (telaExtra) {
    const monitorExibido = monitorAtual ?? monitorAlvo;
    return (
      <div className="fixed inset-0 bg-black">
        {mostrarMonitor && monitorExibido && (
          <div className="pointer-events-none fixed left-1/2 top-2 z-[90] -translate-x-1/2 rounded-md bg-background/90 px-3 py-1.5 text-sm font-semibold text-foreground shadow-lg backdrop-blur-sm transition-opacity duration-500">
            {`Monitor ${monitorExibido.numero}${monitorExibido.rotulo ? ` · ${monitorExibido.rotulo}` : ""}`}
          </div>
        )}
        {layout ? (
          renderGrid(true)
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            Carregando o mosaico…
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {deteccaoId && !rondaId && apresentacaoRotacao && (
        <div
          className={`fixed left-3 z-[60] max-w-[min(36rem,calc(100vw-1.5rem))] rounded-md border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur ${
            filaBolinha.length > 0 ? "bottom-12" : "bottom-3"
          } ${apresentacaoRotacao.tipo === "falha" ? "border-destructive/50 text-destructive" : "border-border text-foreground"}`}
          role="status"
          aria-live="polite"
        >
          <p className="font-medium">{apresentacaoRotacao.titulo}</p>
          <p className="mt-0.5 break-words text-muted-foreground">{apresentacaoRotacao.detalhe}</p>
        </div>
      )}
      {deteccaoId && !rondaId && filaBolinha.length > 0 && (
        <div className="fixed bottom-3 left-3 z-[60] flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium whitespace-nowrap">{filaBolinha[0]}</span>
          {filaBolinha.length > 1 && (
            <span className="whitespace-nowrap text-muted-foreground">
              +{filaBolinha.length - 1} na fila
            </span>
          )}
        </div>
      )}
      <PageHeader
        title="Visualização"
        description="Monte layouts com as câmeras dos DVRs e acompanhe ao vivo. O tempo até o primeiro quadro não mede o atraso da cena."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!clienteId} onClick={() => setNovoAberto(true)}>
              <Plus className="mr-2 h-4 w-4" /> Novo layout
            </Button>
            <Button variant="outline" disabled={!layout} onClick={abrirNovaTela}>
              <AppWindow className="mr-2 h-4 w-4" /> Nova tela
            </Button>
            {telas.length > 0 && (
              <Button variant="ghost" onClick={fecharTelas} title="Fechar as telas abertas">
                <X className="mr-2 h-4 w-4" /> Fechar telas ({telas.length})
              </Button>
            )}
            {layout && (
              <>
                <Button variant="outline" onClick={entrarTelaCheia}>
                  <Maximize2 className="mr-2 h-4 w-4" /> Tela cheia
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm(`Excluir o layout "${layout.nome}"?`)) excluir.mutate();
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </Button>
                <Button onClick={() => salvar.mutate()} disabled={!sujo || salvar.isPending}>
                  <Save className="mr-2 h-4 w-4" /> Salvar layout
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex h-[calc(100vh-11rem)] min-h-[460px] gap-4">
        {painelAberto ? (
          <div className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <Label>Cliente</Label>
                  <button
                    type="button"
                    onClick={() => setPainelAberto(false)}
                    className="text-muted-foreground transition hover:text-foreground"
                    title="Recolher painel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ComboSelect
                  value={clienteId}
                  onChange={setClienteId}
                  disabled={clienteFixo}
                  options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Selecione o cliente"
                  searchPlaceholder="Pesquisar cliente..."
                />
                <Label>Layout</Label>
                <ComboSelect
                  value={opcaoSelecionada}
                  onChange={(opcao) => {
                    const separador = opcao.indexOf(":");
                    const tipo = opcao.slice(0, separador);
                    const id = opcao.slice(separador + 1);
                    if (!id) return;
                    if (tipo === "ronda") {
                      setDeteccaoId(null);
                      setRondaId(id);
                      return;
                    }
                    if (tipo === "deteccao") {
                      setRondaId(null);
                      setDeteccaoId(id);
                      return;
                    }
                    setDeteccaoId(null);
                    setRondaId(null);
                    setLayoutId(id);
                  }}
                  disabled={!clienteId}
                  options={opcoesDeVisualizacao}
                  placeholder={clienteId ? "Selecione um layout" : "Escolha o cliente primeiro"}
                  searchPlaceholder="Pesquisar layout, ronda ou detecção..."
                />

                {sujo && (
                  <p className="text-xs text-muted-foreground">
                    Há alterações não salvas. Clique em “Salvar layout”.
                  </p>
                )}
              </CardContent>
            </Card>

            {telas.length > 0 && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <Label>Telas abertas ({telas.length + 1})</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Escolha o layout de cada tela separadamente.
                  </p>

                  {!monitores.length && suportaMonitores() && (
                    <button
                      type="button"
                      onClick={() => void listarMonitores().then(setMonitores)}
                      className="w-full rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
                    >
                      Reconhecer meus monitores
                    </button>
                  )}

                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-xs font-medium">
                      Tela principal (esta)
                      {monitores.length
                        ? ` · ${
                            monitorDaPosicao(
                              monitores,
                              window.screenX,
                              window.screenY,
                              window.outerWidth,
                              window.outerHeight,
                            )?.rotulo ?? "Monitor desconhecido"
                          }`
                        : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {layout?.nome ?? "Sem layout"}
                    </p>
                  </div>

                  {telas.map((t, i) => {
                    const opcoes = (layouts.data ?? []).filter(
                      (l) => l.cliente_id === (t.clienteId ?? clienteId),
                    );
                    const mon = monitorDaTela(t);
                    const guardado = encontrarMonitor(monitores, t.monitorId);
                    const rotuloMonitor = mon
                      ? mon.rotulo
                      : t.monitorId && monitores.length && !guardado
                        ? "Monitor desconectado"
                        : (guardado?.rotulo ?? "");
                    return (
                      <div key={t.id} className="space-y-1.5 rounded-md border border-border p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">
                            Tela {i + 2}
                            {rotuloMonitor ? ` · ${rotuloMonitor}` : ""}
                          </p>
                          <button
                            type="button"
                            onClick={() => fecharTela(t.id)}
                            className="text-muted-foreground transition hover:text-destructive"
                            title="Fechar esta tela"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <ComboSelect
                          value={t.layoutId ?? ""}
                          onChange={(v) => trocarLayoutDaTela(t, v)}
                          options={opcoes.map((l) => ({
                            value: l.id,
                            label: `${l.nome} · ${mosaicoDe(l.template, l.colunas, l.linhas).nome}`,
                          }))}
                          placeholder="Selecione um layout"
                          searchPlaceholder="Pesquisar layout..."
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {clienteId && <PainelCameras dvrs={dvrsDoCliente} onAdicionar={adicionarProxima} />}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPainelAberto(true)}
            className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
            title="Mostrar painel"
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px] font-medium [writing-mode:vertical-rl] rotate-180">
              Câmeras
            </span>
          </button>
        )}

        <div className="min-w-0 flex-1">
          {layout ? (
            grade
          ) : (
            <Card className="h-full">
              <CardContent className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                {layouts.isLoading
                  ? "Carregando layouts..."
                  : "Nenhum layout ainda. Crie o primeiro em “Novo layout”."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <NovoLayoutDialog
        open={novoAberto}
        onOpenChange={setNovoAberto}
        onCriar={(v) => criar.mutate(v)}
        pendente={criar.isPending}
        clienteId={clienteId}
        dvrs={dvrsDoCliente}
      />

      {editSlot !== null && (
        <SlotDialog
          slot={slots[editSlot] ?? null}
          dvrs={dvrsDoCliente}
          onClose={() => setEditSlot(null)}
          onSalvar={(s) => {
            atualizarSlot(editSlot, s);
            setEditSlot(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Tile da câmera ---------- */

/** Ampliada = principal; ao sair, a conexão principal fica 1 min de reserva. */
function CameraTile({
  slot,
  nome,
  editavel,
  arrastavel,
  expandida,
  oculta = false,
  movimento = false,
  onFecharExpandida,
  onDragStart,
  onRemover,
  onEditar,
}: {
  slot: NonNullable<Slot>;
  nome: string;
  /** Mostra os botões de configurar e remover (só fora da tela cheia). */
  editavel: boolean;
  /** Câmera enviou aviso de movimento há pouco: borda verde. */
  movimento?: boolean;
  /** Permite reposicionar a câmera arrastando, inclusive em tela cheia. */
  arrastavel?: boolean;
  expandida: boolean;
  /** Outra câmera está ampliada: esta não deve solicitar imagem. */
  oculta?: boolean;
  onFecharExpandida: () => void;
  onDragStart: (e: DragEvent) => void;
  onRemover: () => void;
  onEditar: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [erro, setErro] = useState(false);
  const url = slot.url?.trim();
  const aoVivo = !url;
  // recarrega imagens estáticas (snapshot) a cada 3s; streams MJPEG continuam sozinhos
  useEffect(() => {
    if (!url || /mjpe?g|stream/i.test(url)) return;
    const t = setInterval(() => setTick((v) => v + 1), 3000);
    return () => clearInterval(t);
  }, [url]);

  const src = url ? (tick ? `${url}${url.includes("?") ? "&" : "?"}_t=${tick}` : url) : null;

  const midia = oculta ? (
    <div className="h-full w-full bg-black" />
  ) : aoVivo ? (
    <CameraAoVivo
      key={`${slot.dvr_id}:${slot.canal}`}
      dvrId={slot.dvr_id}
      canal={slot.canal}
      contido={false}
      qualidade={expandida ? "principal" : "extra"}
    />
  ) : src && !erro ? (
    <img
      src={src}
      alt={`${nome} canal ${slot.canal}`}
      onError={() => setErro(true)}
      className="h-full w-full object-fill"
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/60">
      <Camera className="h-7 w-7" />
      <span className="text-[11px]">{erro ? "Sem sinal" : "Sem endereço de imagem"}</span>
    </div>
  );

  // Tela cheia: o MESMO elemento continua montado, apenas muda de estilo — sem reconectar
  return (
    <div
      draggable={(arrastavel ?? editavel) && !expandida}
      onDragStart={onDragStart}
      onDoubleClick={
        expandida
          ? (e) => {
              e.stopPropagation();
              onFecharExpandida();
            }
          : undefined
      }
      className={
        expandida
          ? "fixed inset-0 z-[60] bg-black"
          : "group/tile relative h-full w-full cursor-grab active:cursor-grabbing"
      }
    >
      <ZoomCamera reset={expandida} compacto={!expandida}>
        {midia}
      </ZoomCamera>
      {movimento && (
        <div className="pointer-events-none absolute inset-0 z-[5] border-4 border-emerald-400 shadow-[inset_0_0_18px_rgba(52,211,153,0.6)]">
          <span className="absolute left-1 top-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">
            Movimento
          </span>
        </div>
      )}
      {expandida ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white/80 backdrop-blur">
            {nome} · CH {slot.canal}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 bg-black/50 p-0 text-white hover:bg-black/70"
            onClick={onFecharExpandida}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-[11px] text-white opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="truncate font-medium">{nome}</span>
            <span className="opacity-70">CH {slot.canal}</span>
          </div>
          {editavel && (
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                onClick={onEditar}
                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                title="Configurar"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onRemover}
                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                title="Remover"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {(arrastavel ?? editavel) && (
            <GripVertical className="absolute left-1 top-1 h-4 w-4 text-white/50 opacity-0 transition group-hover:opacity-100" />
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Zoom com a roda do mouse (tela cheia ou no mosaico) ---------- */

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

function ZoomCamera({
  reset,
  compacto,
  children,
}: {
  /** Muda quando a câmera entra/sai da tela cheia: o zoom volta ao normal. */
  reset: boolean;
  compacto: boolean;
  children: React.ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrasto = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const limitar = useCallback((x: number, y: number, z: number) => {
    const area = areaRef.current;
    if (!area) return { x: 0, y: 0 };
    const { width, height } = area.getBoundingClientRect();
    return {
      x: Math.min(0, Math.max(width - width * z, x)),
      y: Math.min(0, Math.max(height - height * z, y)),
    };
  }, []);

  // Ao alternar tela cheia o zoom volta ao normal.
  useEffect(() => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, [reset]);

  const estado = useRef({ zoom, pos });
  estado.current = { zoom, pos };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const aoGirar = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const atual = estado.current.zoom;
      const proximo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, atual * Math.exp(-dy * 0.0018)));
      if (proximo === atual) return;
      const rect = area.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const k = proximo / atual;
      const bruto = {
        x: px - (px - estado.current.pos.x) * k,
        y: py - (py - estado.current.pos.y) * k,
      };
      setZoom(proximo);
      setPos(limitar(bruto.x, bruto.y, proximo));
    };
    area.addEventListener("wheel", aoGirar, { passive: false });
    return () => area.removeEventListener("wheel", aoGirar);
  }, [limitar]);

  // Mini-mapa: desenha o quadro inteiro e destaca a região ampliada.
  useEffect(() => {
    if (zoom <= 1) return;
    const desenhar = () => {
      const canvas = miniRef.current;
      const area = areaRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !area || !ctx) return;
      const fonte =
        (area.querySelector("video") as HTMLVideoElement | null) ??
        (area.querySelector("img") as HTMLImageElement | null);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (fonte) {
        try {
          ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
        } catch {
          // Quadro ainda indisponível.
        }
      }
      const { width, height } = area.getBoundingClientRect();
      const fx = -pos.x / (width * zoom);
      const fy = -pos.y / (height * zoom);
      const fw = 1 / zoom;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(fx * canvas.width, fy * canvas.height, fw * canvas.width, fw * canvas.height);
    };
    desenhar();
    const t = setInterval(desenhar, 500);
    return () => clearInterval(t);
  }, [zoom, pos]);

  return (
    <div
      ref={areaRef}
      className={`relative h-full w-full overflow-hidden ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      onPointerDown={(e) => {
        if (zoom <= 1) return;
        e.stopPropagation();
        arrasto.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const a = arrasto.current;
        if (!a) return;
        setPos(limitar(a.ox + (e.clientX - a.x), a.oy + (e.clientY - a.y), zoom));
      }}
      onPointerUp={() => {
        arrasto.current = null;
      }}
    >
      <div
        className="h-full w-full"
        style={{
          transformOrigin: "0 0",
          transform: zoom > 1 ? `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` : undefined,
        }}
      >
        {children}
      </div>
      {zoom > 1 && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-20 overflow-hidden rounded-md border border-white/30 bg-black/70 shadow-lg backdrop-blur">
          <canvas
            ref={miniRef}
            width={200}
            height={112}
            className={compacto ? "block h-[68px] w-[120px]" : "block h-[112px] w-[200px]"}
          />
          <div className="px-2 py-0.5 text-center text-[10px] font-medium text-white/80">
            {zoom.toFixed(1)}×
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Painel lateral de câmeras arrastáveis ---------- */

function PainelCameras({
  dvrs,
  onAdicionar,
}: {
  dvrs: { id: string; nome: string; canais: number; servidor: string }[];
  onAdicionar: (s: { dvr_id: string; canal: number }) => void;
}) {
  const [dvrIds, setDvrIds] = useState<string[]>([]);
  const [aberto, setAberto] = useState(false);
  const selecionados = dvrIds.length ? dvrs.filter((d) => dvrIds.includes(d.id)) : dvrs.slice(0, 1);

  // Catálogo enviado automaticamente pelo servidor (sinal de vida)
  const ids = selecionados.map((d) => d.id);
  const catalogo = useQuery({
    queryKey: ["cameras", ids],
    enabled: ids.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("dvr_id, canal, nome, online")
        .in("dvr_id", ids)
        .order("canal");
      if (error) throw error;
      return data;
    },
  });
  const porDvr = new Map<
    string,
    Map<number, { canal: number; nome: string | null; online: boolean | null }>
  >();
  for (const c of catalogo.data ?? []) {
    if (!porDvr.has(c.dvr_id)) porDvr.set(c.dvr_id, new Map());
    porDvr.get(c.dvr_id)!.set(c.canal, c);
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <Label className="cursor-pointer">Câmeras disponíveis</Label>
          {aberto ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {aberto && (
          <>
            <ComboMultiSelect
              values={selecionados.map((d) => d.id)}
              onChange={setDvrIds}
              options={dvrs.map((d) => ({ value: d.id, label: d.nome, hint: d.servidor }))}
              placeholder="Escolha um ou mais DVRs"
              searchPlaceholder="Pesquisar DVR..."
              emptyText="Nenhum DVR encontrado."
            />

            <p className="text-xs text-muted-foreground">
              Arraste um canal para o mosaico ou dê dois cliques para colocá-lo na próxima posição
              livre.
            </p>
            {selecionados.map((dvr) => {
              const porCanal = porDvr.get(dvr.id) ?? new Map();
              const total = Math.max(dvr.canais ?? 0, ...[...porCanal.keys()], 0);
              const canais = Array.from({ length: total }, (_, i) => i + 1);
              return (
                <div key={dvr.id} className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">{dvr.nome}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {canais.map((c) => {
                      const cam = porCanal.get(c);
                      return (
                        <div
                          key={c}
                          draggable
                          title={cam?.nome ?? `Canal ${c}`}
                          onDoubleClick={() => onAdicionar({ dvr_id: dvr.id, canal: c })}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              DND_TYPE,
                              JSON.stringify({ slot: { dvr_id: dvr.id, canal: c } }),
                            );
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          className="flex cursor-grab select-none items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-2 text-xs font-medium hover:border-primary/60 active:cursor-grabbing"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${cam ? (cam.online ? "bg-primary" : "bg-destructive") : "bg-muted-foreground/40"}`}
                          />
                          <span className="truncate">
                            {cam?.nome?.trim() ? cam.nome : `CH ${c}`}
                          </span>
                        </div>
                      );
                    })}
                    {!canais.length && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        Nenhuma câmera informada pelo servidor ainda.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Diálogos ---------- */

export function MosaicoPreview({ mosaico, ativo }: { mosaico: Mosaico; ativo?: boolean }) {
  return (
    <div
      className="grid gap-[3px]"
      style={{
        gridTemplateColumns: `repeat(${mosaico.colunas}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${mosaico.linhas}, minmax(0, 1fr))`,
        aspectRatio: `${mosaico.colunas * 16} / ${mosaico.linhas * 9}`,
      }}
    >
      {mosaico.celulas.map((cel, i) => (
        <div
          key={i}
          style={estiloCelula(cel)}
          className={`rounded-[3px] ${ativo ? "bg-primary/70" : "bg-muted-foreground/25"}`}
        />
      ))}
    </div>
  );
}

function NovoLayoutDialog({
  open,
  onOpenChange,
  onCriar,
  pendente,
  clienteId,
  dvrs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriar: (v: {
    nome: string;
    colunas: number;
    linhas: number;
    template: string;
    slots: LayoutCameraSlot[];
  }) => void;
  pendente: boolean;
  clienteId: string;
  dvrs: { id: string; nome: string; canais: number; servidor: string }[];
}) {
  const [nome, setNome] = useState("");
  const [template, setTemplate] = useState("2x2");
  const [formatosAbertos, setFormatosAbertos] = useState(true);
  const [dvrIds, setDvrIds] = useState<string[]>([]);
  const [cameras, setCameras] = useState<LayoutCameraSlot[]>([]);
  const ehAuto = template === "auto";
  const customs = useQuery({
    queryKey: ["mosaicos-personalizados"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mosaicos_personalizados")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const meusCustoms = (customs.data ?? []).filter((m) => m.cliente_id === clienteId);
  const custom = decodificarCustom(template);
  // No automático a grade se ajusta sozinha às câmeras que forem adicionadas
  // (até 64). Não se escolhe capacidade na criação.
  const escolhido = ehAuto
    ? mosaicoAutomatico(64)
    : (custom ?? MOSAICOS.find((m) => m.id === template) ?? MOSAICOS[2]!);
  const previaAuto = mosaicoAutomatico(6);
  const limite = ehAuto ? 64 : escolhido.celulas.length;
  const nomeFormato = ehAuto
    ? "Automático · ajusta às câmeras"
    : (meusCustoms.find(
        (m) =>
          codificarCustom(
            m.colunas,
            m.linhas,
            Array.isArray(m.celulas) ? (m.celulas as unknown as Celula[]) : [],
          ) === template,
      )?.nome ?? escolhido.nome);

  const selecionarFormato = (novoTemplate: string) => {
    setTemplate(novoTemplate);
    setFormatosAbertos(false);
  };

  useEffect(() => {
    setCameras((atuais) => atuais.slice(0, limite));
  }, [limite]);

  useEffect(() => {
    if (!open) return;
    setDvrIds([]);
    setCameras([]);
    setFormatosAbertos(true);
  }, [open, clienteId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo layout</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Portaria"
            />
          </div>
          <div className="space-y-2">
            <Label>Formato do mosaico</Label>
            {!formatosAbertos && (
              <div className="flex items-center gap-3 rounded-lg border border-primary bg-primary/5 p-2">
                <div className="w-24 shrink-0">
                  <MosaicoPreview mosaico={ehAuto ? previaAuto : escolhido} ativo />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{nomeFormato}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormatosAbertos(true)}
                >
                  Trocar
                </Button>
              </div>
            )}
            {formatosAbertos && (
              <div className="grid max-h-[46vh] grid-cols-2 gap-3 overflow-auto pr-1 sm:grid-cols-4">
                {/* Opção Automático */}
                <button
                  type="button"
                  onClick={() => selecionarFormato("auto")}
                  className={`rounded-lg border p-2 text-left transition ${
                    ehAuto ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                >
                  <MosaicoPreview mosaico={previaAuto} ativo={ehAuto} />
                  <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
                    Automático · ajusta às câmeras
                  </p>
                </button>
                {meusCustoms.map((m) => {
                  const celulas = Array.isArray(m.celulas)
                    ? (m.celulas as unknown as Celula[])
                    : [];
                  if (!celulas.length) return null;
                  const cod = codificarCustom(m.colunas, m.linhas, celulas);
                  const ativo = cod === template;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selecionarFormato(cod)}
                      className={`rounded-lg border p-2 text-left transition ${
                        ativo
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <MosaicoPreview
                        mosaico={{
                          id: cod,
                          nome: m.nome,
                          colunas: m.colunas,
                          linhas: m.linhas,
                          celulas,
                        }}
                        ativo={ativo}
                      />
                      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
                        {m.nome} · personalizado
                      </p>
                    </button>
                  );
                })}
                {MOSAICOS.map((m) => {
                  const ativo = m.id === template;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selecionarFormato(m.id)}
                      className={`rounded-lg border p-2 text-left transition ${
                        ativo
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <MosaicoPreview mosaico={m} ativo={ativo} />
                      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
                        {m.nome}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {ehAuto && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              A grade muda sozinha conforme você adiciona câmeras ao layout (até 64).
            </p>
          )}
          <LayoutCameraSelector
            dvrs={dvrs}
            dvrIds={dvrIds}
            onDvrIdsChange={setDvrIds}
            cameras={cameras}
            onCamerasChange={setCameras}
            limite={limite}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={!nome.trim() || pendente}
            onClick={() => {
              onCriar({
                nome: nome.trim(),
                colunas: escolhido.colunas,
                linhas: escolhido.linhas,
                template: escolhido.id,
                slots: cameras,
              });
              setNome("");
              setDvrIds([]);
              setCameras([]);
            }}
          >
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlotDialog({
  slot,
  dvrs,
  onClose,
  onSalvar,
}: {
  slot: Slot;
  dvrs: { id: string; nome: string; canais: number }[];
  onClose: () => void;
  onSalvar: (s: Slot) => void;
}) {
  const [dvrId, setDvrId] = useState(slot?.dvr_id ?? dvrs[0]?.id ?? "");
  const [canal, setCanal] = useState(String(slot?.canal ?? 1));
  const [url, setUrl] = useState(slot?.url ?? "");
  const dvr = dvrs.find((d) => d.id === dvrId);
  const canais = Array.from({ length: Math.max(dvr?.canais ?? 1, 1) }, (_, i) => i + 1);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Câmera nesta posição</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>DVR</Label>
            <ComboSelect
              value={dvrId}
              onChange={setDvrId}
              options={dvrs.map((d) => ({ value: d.id, label: d.nome }))}
              placeholder="Escolha o DVR"
              searchPlaceholder="Pesquisar DVR..."
            />
          </div>
          <div className="space-y-2">
            <Label>Canal</Label>
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canais.map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    Canal {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Endereço da imagem ao vivo (opcional)</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://... (snapshot JPG ou stream MJPEG)"
            />
            <p className="text-xs text-muted-foreground">
              Endereço HTTP fornecido pelo servidor do cliente. Imagens estáticas são atualizadas a
              cada 3 segundos.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!dvrId}
            onClick={() =>
              onSalvar(
                url.trim()
                  ? { dvr_id: dvrId, canal: Number(canal), url: url.trim() }
                  : { dvr_id: dvrId, canal: Number(canal) },
              )
            }
          >
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
