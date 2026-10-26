import { TIPOS_DETECCAO, verificarLimiteDeteccao, type TipoDeteccao } from "@/lib/tipos-deteccao";
import {
  TODOS_OS_TIPOS,
  camerasDoTipoFiltro,
  chaveCamera,
  indicesPorTipo,
  opcoesDeTipo,
  type DeteccoesPorTipo,
} from "@/lib/deteccao-filtro";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Eraser, Grid2x2, LayoutGrid, Save, ScanEye, SquareDashed } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery, servidoresQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { PageHeader } from "@/components/PageHeader";
import { ComboSelect } from "@/components/ComboSelect";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DeteccaoLayouts } from "@/components/DeteccaoLayouts";
import { mascaraPadrao } from "@/lib/deteccao-grade";
import { DeteccaoPortao } from "@/components/DeteccaoPortao";
import { DeteccaoPortaoV2 } from "@/components/DeteccaoPortaoV2";

export const Route = createFileRoute("/_authenticated/deteccao")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search["tab"] === "layouts" || search["tab"] === "areas" ? search["tab"] : undefined,
    layoutDeteccaoId:
      typeof search["layoutDeteccaoId"] === "string" ? search["layoutDeteccaoId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Detecção — Sentinela VIEW" },
      {
        name: "description",
        content:
          "Escolha a câmera e desenhe sobre a imagem as áreas que não devem gerar detecção de movimento.",
      },
      { property: "og:title", content: "Detecção — Sentinela VIEW" },
      {
        property: "og:description",
        content: "Áreas ignoradas e sensibilidade da detecção de movimento por câmera.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeteccaoPage,
});

const TODOS = "__todos__";
const COLUNAS = 32;
const LINHAS = 24;
// pixels amostrados por célula na análise de movimento
const PASSO = 5;

type CameraLinha = {
  id: string;
  dvr_id: string;
  canal: number;
  nome: string | null;
  servidor_id: string | null;
  cliente_id: string | null;
};

type Config = {
  id: string;
  dvr_id: string;
  canal: number;
  ativo: boolean;
  colunas: number;
  linhas: number;
  ignorados: number[];
  sensibilidade: number;
};

function DeteccaoPage() {
  const search = Route.useSearch();
  const { can } = useAuth();
  const podeEditar = can("deteccao.editar");
  const queryClient = useQueryClient();
  const {
    clienteId: clienteGlobal,
    setClienteId,
    clientes: clientesPermitidos,
  } = useClienteSelecionado();

  const clientes = useQuery(clientesQuery);
  const servidores = useQuery({ ...servidoresQuery, refetchInterval: 15000, refetchOnWindowFocus: true });
  const dvrs = useQuery(dvrsQuery);

  const [servidorId, setServidorId] = useState(TODOS);
  const [dvrId, setDvrId] = useState(TODOS);
  const [cameraKey, setCameraKey] = useState("");
  // mostra só as câmeras com a detecção do tipo escolhido ligada
  const [filtroTipo, setFiltroTipo] = useState<TipoDeteccao | typeof TODOS_OS_TIPOS>(
    TODOS_OS_TIPOS,
  );

  const [tipoDeteccao, setTipoDeteccao] = useState<TipoDeteccao>("movimento");
  const [aba, setAba] = useState(search.tab === "layouts" ? "layouts" : "areas");

  /* ---------- opções dos filtros ---------- */

  const opcoesClientes = useMemo(
    () =>
      (clientesPermitidos.length
        ? clientesPermitidos
        : (clientes.data ?? []).map((c) => ({ id: c.id, nome: c.nome }))
      ).map((c) => ({ value: c.id, label: c.nome })),
    [clientesPermitidos, clientes.data],
  );

  const opcoesServidores = useMemo(() => {
    const lista = (servidores.data ?? []).filter(
      (s) => !clienteGlobal || s.cliente_id === clienteGlobal,
    );
    return [
      { value: TODOS, label: "Todos os servidores" },
      ...lista.map((s) => ({ value: s.id, label: s.nome })),
    ];
  }, [servidores.data, clienteGlobal]);

  const opcoesDvrs = useMemo(() => {
    const lista = (dvrs.data ?? []).filter(
      (d) =>
        (!clienteGlobal || d.cliente_id === clienteGlobal) &&
        (servidorId === TODOS || d.servidor_id === servidorId),
    );
    return [
      { value: TODOS, label: "Todos os DVRs" },
      ...lista.map((d) => ({ value: d.id, label: d.nome })),
    ];
  }, [dvrs.data, clienteGlobal, servidorId]);

  // filtros voltam para "todos" quando o que estava escolhido sai da lista
  useEffect(() => {
    if (servidorId !== TODOS && !opcoesServidores.some((o) => o.value === servidorId)) {
      setServidorId(TODOS);
    }
  }, [opcoesServidores, servidorId]);
  useEffect(() => {
    if (dvrId !== TODOS && !opcoesDvrs.some((o) => o.value === dvrId)) setDvrId(TODOS);
  }, [opcoesDvrs, dvrId]);

  /* ---------- câmeras ---------- */

  const dvrsFiltrados = useMemo(
    () =>
      (dvrs.data ?? []).filter(
        (d) =>
          (!clienteGlobal || d.cliente_id === clienteGlobal) &&
          (servidorId === TODOS || d.servidor_id === servidorId) &&
          (dvrId === TODOS || d.id === dvrId),
      ),
    [dvrs.data, clienteGlobal, servidorId, dvrId],
  );

  const idsDvrs = useMemo(() => dvrsFiltrados.map((d) => d.id), [dvrsFiltrados]);

  const camerasQ = useQuery({
    queryKey: ["deteccao-cameras", idsDvrs],
    enabled: idsDvrs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("id, dvr_id, canal, nome, servidor_id, cliente_id")
        .in("dvr_id", idsDvrs)
        .order("canal");
      if (error) throw error;
      return (data ?? []) as CameraLinha[];
    },
  });

  /* ---------- câmeras com cada tipo de detecção ligado ---------- */

  const deteccoesPorTipoQ = useQuery({
    queryKey: ["deteccao-cameras-por-tipo", idsDvrs],
    enabled: idsDvrs.length > 0,
    queryFn: async () => {
      const linhas: DeteccoesPorTipo = {};
      for (const tipo of TIPOS_DETECCAO) {
        const { data, error } = await supabase
          .from(tipo.tabela as never)
          .select("dvr_id, canal")
          .eq("ativo", true)
          .in("dvr_id", idsDvrs);
        if (error) throw error;
        linhas[tipo.value] = (data ?? []) as { dvr_id: string; canal: number }[];
      }
      return linhas;
    },
  });

  // ao filtrar por um tipo, o editor abaixo passa a mostrar esse tipo
  useEffect(() => {
    if (filtroTipo !== TODOS_OS_TIPOS) setTipoDeteccao(filtroTipo);
  }, [filtroTipo]);

  const nomeDvr = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const d of dvrs.data ?? []) mapa.set(d.id, d.nome);
    return mapa;
  }, [dvrs.data]);

  const camerasPorTipo = useMemo(
    () => indicesPorTipo(deteccoesPorTipoQ.data),
    [deteccoesPorTipoQ.data],
  );

  const opcoesTipos = useMemo(
    () => opcoesDeTipo(deteccoesPorTipoQ.data),
    [deteccoesPorTipoQ.data],
  );

  const camerasFiltradas = useMemo(
    () =>
      camerasDoTipoFiltro(
        camerasQ.data ?? [],
        filtroTipo === TODOS_OS_TIPOS ? null : filtroTipo,
        camerasPorTipo,
      ),
    [camerasQ.data, filtroTipo, camerasPorTipo],
  );

  const opcoesCameras = useMemo(
    () =>
      camerasFiltradas.map((c) => ({
        value: chaveCamera(c.dvr_id, c.canal),
        label: c.nome?.trim() || `Canal ${c.canal}`,
        hint: nomeDvr.get(c.dvr_id) ?? "",
      })),
    [camerasFiltradas, nomeDvr],
  );

  useEffect(() => {
    if (cameraKey && !opcoesCameras.some((o) => o.value === cameraKey)) setCameraKey("");
  }, [opcoesCameras, cameraKey]);

  const [camDvrId, camCanalTexto] = cameraKey ? cameraKey.split(":") : ["", ""];
  const camCanal = Number(camCanalTexto);
  const cameraSelecionada = Boolean(camDvrId) && Number.isFinite(camCanal);

  /* ---------- configuração salva ---------- */

  const configQ = useQuery({
    queryKey: ["deteccao-config", cameraKey],
    enabled: cameraSelecionada,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras_deteccao" as never)
        .select("id, dvr_id, canal, ativo, colunas, linhas, ignorados, sensibilidade")
        .eq("dvr_id", camDvrId ?? "")
        .eq("canal", camCanal)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Config | null;
    },
  });

  const [ignorados, setIgnorados] = useState<Set<number>>(new Set());
  const [sensibilidade, setSensibilidade] = useState(50);
  // padrão: detecção desligada até alguém ativar e salvar
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    if (!cameraSelecionada) return;
    const c = configQ.data;
    setIgnorados(new Set(mascaraPadrao(c)));
    setSensibilidade(c?.sensibilidade ?? 50);
    setAtivo(c?.ativo ?? false);
  }, [configQ.data, cameraSelecionada]);

  /* ---------- aviso de movimento na grade ---------- */

  // O evento de movimento não traz coordenadas, só DVR e canal. Então,
  // quando chega movimento da câmera aberta, destacamos com borda as áreas
  // ativas (não ignoradas) por alguns segundos.
  const [movimentoEm, setMovimentoEm] = useState<number | null>(null);

  useEffect(() => {
    if (!cameraSelecionada || !camDvrId) {
      setMovimentoEm(null);
      return;
    }
    let timer: number | null = null;
    const canal = supabase
      .channel(`deteccao-tela:${camDvrId}:${camCanal}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eventos_deteccao",
          filter: `dvr_id=eq.${camDvrId}`,
        },
        (payload) => {
          const evento = payload.new as { canal?: number };
          if (evento.canal !== camCanal) return;
          setMovimentoEm(Date.now());
          if (timer !== null) window.clearTimeout(timer);
          timer = window.setTimeout(() => setMovimentoEm(null), 6000);
        },
      )
      .subscribe();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, [cameraSelecionada, camDvrId, camCanal]);

  /* ---------- movimento local: compara quadros da imagem ---------- */

  // Analisa a própria imagem no navegador e marca só as áreas da grade onde
  // os pixels mudaram, para a borda ficar no local exato do movimento.
  const quadroRef = useRef<HTMLDivElement>(null);
  const [celulasMov, setCelulasMov] = useState<Set<number>>(new Set());
  const ignoradosRef = useRef(ignorados);
  ignoradosRef.current = ignorados;
  const sensRef = useRef(sensibilidade);
  sensRef.current = sensibilidade;

  useEffect(() => {
    if (!cameraSelecionada) return;
    const W = COLUNAS * PASSO;
    const H = LINHAS * PASSO;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let anterior: Float32Array | null = null;
    const ultimaVez = new Map<number, number>();
    const id = window.setInterval(() => {
      const video = quadroRef.current?.querySelector("video");
      if (!ctx || !video || video.readyState < 2 || !video.videoWidth) return;
      let dados: Uint8ClampedArray;
      try {
        // O vídeo aparece "contido" (com faixas pretas). Desenha na mesma
        // posição que ele ocupa na tela para a grade bater com a imagem.
        const caixa = quadroRef.current!.getBoundingClientRect();
        const escala = Math.min(caixa.width / video.videoWidth, caixa.height / video.videoHeight);
        const vw = ((video.videoWidth * escala) / caixa.width) * W;
        const vh = ((video.videoHeight * escala) / caixa.height) * H;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(video, (W - vw) / 2, (H - vh) / 2, vw, vh);
        dados = ctx.getImageData(0, 0, W, H).data;
      } catch {
        return;
      }
      const atual = new Float32Array(W * H);
      for (let p = 0; p < W * H; p++) {
        atual[p] =
          (dados[p * 4] ?? 0) * 0.3 +
          (dados[p * 4 + 1] ?? 0) * 0.59 +
          (dados[p * 4 + 2] ?? 0) * 0.11;
      }
      const agora = Date.now();
      // Fundo aprendido: comparar com o fundo (e não só com o quadro
      // anterior) marca onde a pessoa ESTÁ, sem deixar rastro de onde passou.
      if (!anterior) {
        anterior = atual.slice();
      } else {
        const fundo = anterior;
        const limiarPixel = 45 - sensRef.current * 0.3;
        const minPixels = Math.max(2, Math.round(8 - sensRef.current * 0.06));
        for (let c = 0; c < COLUNAS * LINHAS; c++) {
          const cx = (c % COLUNAS) * PASSO;
          const cy = Math.floor(c / COLUNAS) * PASSO;
          let mudou = 0;
          for (let y = cy; y < cy + PASSO; y++)
            for (let x = cx; x < cx + PASSO; x++)
              if (Math.abs((atual[y * W + x] ?? 0) - (fundo[y * W + x] ?? 0)) > limiarPixel)
                mudou++;
          const ativa = mudou >= minPixels;
          // fundo se adapta rápido onde não há movimento e devagar onde há
          // (evita "fantasma" se algo parar ou sair de cena)
          const taxa = ativa ? 0.02 : 0.35;
          for (let y = cy; y < cy + PASSO; y++)
            for (let x = cx; x < cx + PASSO; x++) {
              const i = y * W + x;
              fundo[i] = (fundo[i] ?? 0) + ((atual[i] ?? 0) - (fundo[i] ?? 0)) * taxa;
            }
          if (ativa && !ignoradosRef.current.has(c)) ultimaVez.set(c, agora);
        }
      }
      const ativas = new Set<number>();
      for (const [c, t] of ultimaVez) {
        if (agora - t < 150) ativas.add(c);
        else ultimaVez.delete(c);
      }
      setCelulasMov((velho) =>
        velho.size === ativas.size && [...ativas].every((c) => velho.has(c)) ? velho : ativas,
      );
    }, 80);
    return () => {
      window.clearInterval(id);
      setCelulasMov(new Set());
    };
  }, [cameraSelecionada]);

  /* ---------- pintura da grade ---------- */

  const pintando = useRef<null | "marcar" | "desmarcar">(null);

  const aplicar = (indice: number, modo: "marcar" | "desmarcar") => {
    setIgnorados((atual) => {
      const proximo = new Set(atual);
      if (modo === "marcar") proximo.add(indice);
      else proximo.delete(indice);
      return proximo;
    });
  };

  useEffect(() => {
    const soltar = () => {
      pintando.current = null;
    };
    window.addEventListener("pointerup", soltar);
    return () => window.removeEventListener("pointerup", soltar);
  }, []);

  const salvar = useMutation({
    mutationFn: async () => {
      const camera = (camerasQ.data ?? []).find(
        (c) => c.dvr_id === camDvrId && c.canal === camCanal,
      );
      const dvr = (dvrs.data ?? []).find((d) => d.id === camDvrId);
      const linha = {
        cliente_id: camera?.cliente_id ?? dvr?.cliente_id ?? null,
        servidor_id: camera?.servidor_id ?? dvr?.servidor_id ?? null,
        dvr_id: camDvrId,
        canal: camCanal,
        ativo,
        colunas: COLUNAS,
        linhas: LINHAS,
        ignorados: Array.from(ignorados).sort((a, b) => a - b),
        sensibilidade,
      };
      if (ativo) await verificarLimiteDeteccao(linha.cliente_id, "movimento", camDvrId ?? "", camCanal);
      const { error } = await supabase
        .from("cameras_deteccao" as never)
        .upsert(linha as never, { onConflict: "dvr_id,canal" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração de detecção salva.");
      queryClient.invalidateQueries({ queryKey: ["deteccao-config", cameraKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const celulas = COLUNAS * LINHAS;

  const seletorTipo = (
    <div className="space-y-1.5">
      <Label>Tipo de detecção</Label>
      <ComboSelect
        value={tipoDeteccao}
        onChange={(v) =>
          setTipoDeteccao(v === "portao" || v === "portao_v2" ? v : "movimento")
        }
        options={[
          { value: "movimento", label: "Detecção de movimento" },
          { value: "portao", label: "Portão aberto" },
          { value: "portao_v2", label: "Portão aberto 2.0" },
        ]}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Detecção"
        description="Ajuste de câmera e  layouts que aparecem sozinhos quando há detecção."
        actions={
          <div id="acoes-deteccao" className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant={aba === "areas" ? "default" : "outline"}
              onClick={() => setAba("areas")}
            >
              <Grid2x2 className="mr-2 h-4 w-4" /> Áreas por câmera
            </Button>
            <Button
              type="button"
              variant={aba === "layouts" ? "default" : "outline"}
              onClick={() => setAba("layouts")}
            >
              <LayoutGrid className="mr-2 h-4 w-4" /> Layouts de detecção
            </Button>
          </div>
        }
      />

      <Tabs value={aba} onValueChange={(v) => setAba(v)} className="space-y-4">
        <TabsContent value="layouts" forceMount className={aba === "layouts" ? "" : "hidden"}>
          <DeteccaoLayouts
            {...(search.layoutDeteccaoId ? { layoutInicialId: search.layoutDeteccaoId } : {})}
          />
        </TabsContent>

        <TabsContent value="areas" className="space-y-4">
          <Card className="mb-4">
            <CardContent className="grid gap-4 p-4 md:grid-cols-5">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <ComboSelect
                  value={clienteGlobal}
                  onChange={setClienteId}
                  options={opcoesClientes}
                  placeholder="Selecionar cliente"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Servidor</Label>
                <ComboSelect
                  value={servidorId}
                  onChange={setServidorId}
                  options={opcoesServidores}
                />
              </div>
              <div className="space-y-1.5">
                <Label>DVR</Label>
                <ComboSelect value={dvrId} onChange={setDvrId} options={opcoesDvrs} />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <ComboSelect
                  value={filtroTipo}
                  onChange={(v) => setFiltroTipo(v as TipoDeteccao | typeof TODOS_OS_TIPOS)}
                  options={opcoesTipos}
                  placeholder="Todos os tipos"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Câmera</Label>
                <ComboSelect
                  value={cameraKey}
                  onChange={setCameraKey}
                  options={opcoesCameras}
                  placeholder={
                    camerasQ.isLoading || deteccoesPorTipoQ.isLoading
                      ? "Carregando câmeras..."
                      : opcoesCameras.length
                        ? "Selecionar câmera"
                        : filtroTipo === TODOS_OS_TIPOS
                          ? "Nenhuma câmera encontrada"
                          : "Nenhuma com este tipo"
                  }
                  emptyText={
                    filtroTipo === TODOS_OS_TIPOS
                      ? "Nenhuma câmera encontrada."
                      : "Nenhuma câmera com essa detecção ligada."
                  }
                />
              </div>
            </CardContent>
          </Card>

          {!cameraSelecionada ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <ScanEye className="h-10 w-10 opacity-40" />
                <p>Selecione uma câmera para abrir a imagem e ajustar as áreas de detecção.</p>
              </CardContent>
            </Card>
          ) : tipoDeteccao === "portao" || tipoDeteccao === "portao_v2" ? (
            (() => {
              const cam = (camerasQ.data ?? []).find((c) => c.dvr_id === camDvrId && c.canal === camCanal);
              const dvr = (dvrs.data ?? []).find((d) => d.id === camDvrId);
              const Painel = tipoDeteccao === "portao_v2" ? DeteccaoPortaoV2 : DeteccaoPortao;
              return (
                <Painel
                  key={tipoDeteccao}
                  cameraKey={cameraKey}
                  dvrId={camDvrId!}
                  canal={camCanal}
                  clienteId={cam?.cliente_id ?? dvr?.cliente_id ?? null}
                  servidorId={cam?.servidor_id ?? dvr?.servidor_id ?? null}
                  podeEditar={podeEditar}
                  seletor={seletorTipo}
                />
              );
            })()
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <Card>
                <CardContent className="p-4">
                  <div
                    ref={quadroRef}
                    className="relative aspect-video w-full overflow-hidden rounded-md bg-black"
                  >
                    <CameraAoVivo
                      key={cameraKey}
                      dvrId={camDvrId!}
                      canal={camCanal}
                      contido
                      qualidade="extra"
                    />
                    <div
                      className="absolute inset-0 grid touch-none select-none"
                      style={{
                        gridTemplateColumns: `repeat(${COLUNAS}, minmax(0, 1fr))`,
                        gridTemplateRows: `repeat(${LINHAS}, minmax(0, 1fr))`,
                      }}
                      onPointerLeave={() => {
                        pintando.current = null;
                      }}
                    >
                      {Array.from({ length: celulas }, (_, i) => {
                        const desativada = ignorados.has(i);
                        const comMovimento = celulasMov.has(i) && !desativada;
                        return (
                          <div
                            key={i}
                            role="presentation"
                            onPointerDown={(e) => {
                              if (!podeEditar) return;
                              e.preventDefault();
                              const modo = desativada ? "desmarcar" : "marcar";
                              pintando.current = modo;
                              aplicar(i, modo);
                            }}
                            onPointerEnter={() => {
                              if (!podeEditar || !pintando.current) return;
                              aplicar(i, pintando.current);
                            }}
                            className={
                              desativada
                                ? "border border-destructive/30 bg-destructive/45"
                                : comMovimento
                                  ? "border-2 border-emerald-400 bg-emerald-400/25"
                                  : "border border-white/10 hover:bg-primary/20"
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Clique e arraste sobre a imagem para marcar em vermelho as áreas que devem ser
                    ignoradas. Clique de novo em uma área vermelha para liberá-la.
                    {movimentoEm !== null && (
                      <span className="mt-1 block font-medium text-emerald-500">
                        Aviso de movimento recebido do servidor para esta câmera.
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-5 p-4">
                  {seletorTipo}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Detecção de movimento</Label>
                      <p className="text-xs text-muted-foreground">Liga ou desliga esta câmera.</p>
                    </div>
                    <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!podeEditar} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Sensibilidade</Label>
                      <span className="text-sm text-muted-foreground">{sensibilidade}%</span>
                    </div>
                    <Slider
                      value={[sensibilidade]}
                      onValueChange={(v) => setSensibilidade(v[0] ?? 50)}
                      min={1}
                      max={100}
                      step={1}
                      disabled={!podeEditar}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Áreas</Label>
                    <p className="text-xs text-muted-foreground">
                      {ignorados.size} de {celulas} áreas ignoradas.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!podeEditar}
                        onClick={() => setIgnorados(new Set())}
                      >
                        <Eraser className="mr-2 h-4 w-4" /> Limpar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!podeEditar}
                        onClick={() =>
                          setIgnorados(new Set(Array.from({ length: celulas }, (_, i) => i)))
                        }
                      >
                        <SquareDashed className="mr-2 h-4 w-4" /> Marcar tudo
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!podeEditar}
                        onClick={() =>
                          setIgnorados((atual) => {
                            const proximo = new Set<number>();
                            for (let i = 0; i < celulas; i++) if (!atual.has(i)) proximo.add(i);
                            return proximo;
                          })
                        }
                      >
                        <Grid2x2 className="mr-2 h-4 w-4" /> Inverter
                      </Button>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    disabled={!podeEditar || salvar.isPending}
                    onClick={() => salvar.mutate()}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {salvar.isPending ? "Salvando..." : "Salvar configuração"}
                  </Button>
                  {!podeEditar && (
                    <p className="text-xs text-muted-foreground">
                      Seu perfil pode apenas visualizar esta tela.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
