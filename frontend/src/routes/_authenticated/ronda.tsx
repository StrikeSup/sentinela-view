import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { usePresenca } from "@/lib/presenca";

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
import { ComboSelect } from "@/components/ComboSelect";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { estiloCelula, limiteAuto, mosaicoAdaptado, mosaicoDe } from "@/lib/mosaicos";

import {
  Plus,
  Play,
  Pause,
  Trash2,
  Camera,
  X,
  ArrowUp,
  ArrowDown,
  Save,
  SkipForward,
  Maximize2,
  Minimize2,

} from "lucide-react";

export const Route = createFileRoute("/_authenticated/ronda")({
  validateSearch: (search: Record<string, unknown>) => ({
    rondaId: typeof search["rondaId"] === "string" ? search["rondaId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Ronda — Sentinela VIEW" },
      {
        name: "description",
        content: "Crie rondas alternando layouts de câmeras com tempo definido para cada etapa.",
      },
      { property: "og:title", content: "Ronda — Sentinela VIEW" },
      { property: "og:description", content: "Rondas automáticas entre layouts de câmeras." },
    ],
  }),
  component: RondaPage,
});

type Slot = { dvr_id: string; canal: number; url?: string } | null;
type Layout = {
  id: string;
  nome: string;
  colunas: number;
  linhas: number;
  slots: Slot[];
  cliente_id: string | null;
  template: string | null;
};
type Ronda = { id: string; nome: string; cliente_id: string | null };
type Item = { id: string; ronda_id: string; layout_id: string; ordem: number; segundos: number };

function normalizarSlots(slots: unknown, total: number): Slot[] {
  const arr = Array.isArray(slots) ? (slots as Slot[]) : [];
  const out: Slot[] = [];
  for (let i = 0; i < total; i++) out.push(arr[i] ?? null);
  return out;
}

function RondaPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const { user } = useAuth();
  const clientes = useQuery(clientesQuery);
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
    queryFn: async () => {
      const { data, error } = await supabase.from("rondas").select("*").order("nome");
      if (error) throw error;
      return data as unknown as Ronda[];
    },
  });

  const { clienteId, setClienteId, bloqueado: clienteFixo } = useClienteSelecionado();


  const rondasDoCliente = useMemo(
    () => (rondas.data ?? []).filter((r) => r.cliente_id === clienteId),
    [rondas.data, clienteId],
  );
  const layoutsDoCliente = useMemo(
    () => (layouts.data ?? []).filter((l) => l.cliente_id === clienteId),
    [layouts.data, clienteId],
  );

  const [rondaId, setRondaId] = useState<string | null>(null);
  useEffect(() => {
    if (search.rondaId && rondasDoCliente.some((r) => r.id === search.rondaId)) {
      setRondaId(search.rondaId);
      return;
    }
    if (!rondaId || !rondasDoCliente.some((r) => r.id === rondaId)) {
      setRondaId(rondasDoCliente[0]?.id ?? null);
    }
  }, [rondasDoCliente, rondaId, search.rondaId]);

  const ronda = rondasDoCliente.find((r) => r.id === rondaId) ?? null;

  const itens = useQuery({
    queryKey: ["rondas_itens", rondaId],
    enabled: !!rondaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rondas_itens")
        .select("*")
        .eq("ronda_id", rondaId!)
        .order("ordem");
      if (error) throw error;
      return data as unknown as Item[];
    },
  });

  const [lista, setLista] = useState<Item[]>([]);
  const [sujo, setSujo] = useState(false);
  useEffect(() => {
    setLista(itens.data ?? []);
    setSujo(false);
  }, [itens.data]);

  const [novaAberta, setNovaAberta] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [addLayout, setAddLayout] = useState("");
  const [addSegundos, setAddSegundos] = useState("15");
  const [rodando, setRodando] = useState(false);
  const [passo, setPasso] = useState(0);
  const [restante, setRestante] = useState(0);

  const criar = useMutation({
    mutationFn: async (nome: string) => {
      const { data, error } = await supabase
        .from("rondas")
        .insert({ nome, cliente_id: clienteId || null, criado_por: user?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Ronda;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rondas"] });
      setRondaId(data.id);
      setNovaAberta(false);
      setNomeNova("");
      toast.success("Ronda criada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!ronda) return;
      const { error: delErro } = await supabase.from("rondas_itens").delete().eq("ronda_id", ronda.id);
      if (delErro) throw delErro;
      if (lista.length) {
        const { error } = await supabase.from("rondas_itens").insert(
          lista.map((i, idx) => ({
            ronda_id: ronda.id,
            layout_id: i.layout_id,
            ordem: idx,
            segundos: i.segundos,
          })),
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rondas_itens", rondaId] });
      setSujo(false);
      toast.success("Ronda salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      if (!ronda) return;
      const { error } = await supabase.from("rondas").delete().eq("id", ronda.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rondas"] });
      setRondaId(null);
      toast.success("Ronda excluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // motor da ronda
  const atual = lista[passo] ?? null;
  const segundosEtapa = Math.max(3, lista[passo]?.segundos || 15);

  useEffect(() => {
    if (!rodando || !lista.length) {
      setRestante(0);
      return;
    }
    const fim = Date.now() + segundosEtapa * 1000;
    setRestante(segundosEtapa);
    const t = setInterval(() => {
      const falta = Math.ceil((fim - Date.now()) / 1000);
      if (falta <= 0) {
        setRestante(0);
        setPasso((p) => (p + 1) % lista.length);
        return;
      }
      setRestante(falta);
    }, 250);
    return () => clearInterval(t);
  }, [rodando, passo, segundosEtapa, lista.length]);

  useEffect(() => {
    if (!rodando) setPasso(0);
  }, [rodando]);

  const [telaCheia, setTelaCheia] = useState(false);
  useEffect(() => {
    if (!telaCheia) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTelaCheia(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [telaCheia]);


  const layoutDe = (id: string) => (layouts.data ?? []).find((l) => l.id === id) ?? null;
  const nomeDvr = (id: string) => (dvrs.data ?? []).find((d) => d.id === id)?.nome ?? "DVR";

  const adicionar = () => {
    if (!addLayout) return;
    const seg = Math.max(3, Math.min(600, Number(addSegundos) || 15));
    setLista((p) => [
      ...p,
      { id: `novo-${Date.now()}`, ronda_id: ronda?.id ?? "", layout_id: addLayout, ordem: p.length, segundos: seg },
    ]);
    setSujo(true);
  };

  const mover = (i: number, dir: -1 | 1) => {
    setLista((p) => {
      const next = [...p];
      const alvo = i + dir;
      if (alvo < 0 || alvo >= next.length) return p;
      const tmp = next[alvo]!;
      next[alvo] = next[i]!;
      next[i] = tmp;
      return next;
    });
    setSujo(true);
  };

  const layoutAtual = atual ? layoutDe(atual.layout_id) : null;

  // presença: informa o mosaico em exibição e obedece ao comando do supervisor
  const { setLayoutAtual, layoutForcado } = usePresenca();
  const navegar = useNavigate();
  const forcadoAplicado = useRef<string | null>(null);

  useEffect(() => {
    setLayoutAtual(layoutAtual?.id ?? null);
  }, [layoutAtual, setLayoutAtual]);

  useEffect(() => {
    if (!layoutForcado) return;
    if (forcadoAplicado.current === layoutForcado.em) return;
    forcadoAplicado.current = layoutForcado.em;
    const i = lista.findIndex((it) => it.layout_id === layoutForcado.id);
    if (i >= 0) {
      setPasso(i);
      toast.info("Mosaico alterado pelo supervisor");
      return;
    }
    // layout fora desta ronda: leva o usuário para a Visualização
    void navegar({ to: "/visualizacao" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutForcado, lista]);


  // Pré-conecta TODAS as câmeras da ronda (menos as que já estão na tela),
  // para que a troca de etapa aconteça com a imagem já pronta.
  const slotsAtuais = useMemo(() => {
    if (!layoutAtual) return [] as Slot[];
    const base = Array.isArray(layoutAtual.slots) ? (layoutAtual.slots as Slot[]) : [];
    if (limiteAuto(layoutAtual.template)) return base.filter(Boolean);
    const m = mosaicoDe(layoutAtual.template, layoutAtual.colunas, layoutAtual.linhas);
    return normalizarSlots(layoutAtual.slots, m.celulas.length);
  }, [layoutAtual]);

  const mosaicoAtual = mosaicoAdaptado(
    layoutAtual?.template,
    layoutAtual?.colunas ?? 2,
    layoutAtual?.linhas ?? 2,
    slotsAtuais.filter(Boolean).length,
  );


  // Sem pré-carregamento: só as câmeras da etapa que está na tela são pedidas.



  return (
    <div>
      <PageHeader
        title="Ronda"
        description="Monte sequências de layouts e defina quanto tempo cada um fica na tela."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!clienteId} onClick={() => setNovaAberta(true)}>
              <Plus className="mr-2 h-4 w-4" /> Nova ronda
            </Button>
            {ronda && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm(`Excluir a ronda "${ronda.nome}"?`)) excluir.mutate();
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </Button>
                <Button onClick={() => salvar.mutate()} disabled={!sujo || salvar.isPending}>
                  <Save className="mr-2 h-4 w-4" /> Salvar ronda
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <Label>Cliente</Label>
              <ComboSelect
                value={clienteId}
                onChange={setClienteId}
                disabled={clienteFixo}
                options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione o cliente"
                searchPlaceholder="Pesquisar cliente..."
              />

              <Label>Ronda</Label>
              <ComboSelect
                value={rondaId ?? ""}
                onChange={setRondaId}
                disabled={!clienteId}
                options={rondasDoCliente.map((r) => ({ value: r.id, label: r.nome }))}
                placeholder={clienteId ? "Selecione uma ronda" : "Escolha o cliente primeiro"}
                searchPlaceholder="Pesquisar ronda..."
              />

              {sujo && (
                <p className="text-xs text-muted-foreground">
                  Há alterações não salvas. Clique em “Salvar ronda”.
                </p>
              )}
            </CardContent>
          </Card>

          {ronda && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Label>Adicionar layout à ronda</Label>
                <ComboSelect
                  value={addLayout}
                  onChange={setAddLayout}
                  options={layoutsDoCliente.map((l) => ({
                    value: l.id,
                    label: `${l.nome} · ${mosaicoDe(l.template, l.colunas, l.linhas).nome}`,
                  }))}
                  placeholder="Escolha o layout"
                  searchPlaceholder="Pesquisar layout..."
                />

                <div className="space-y-2">
                  <Label>Tempo na tela (segundos)</Label>
                  <Input
                    type="number"
                    min={3}
                    max={600}
                    value={addSegundos}
                    onChange={(e) => setAddSegundos(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={adicionar} disabled={!addLayout}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar
                </Button>
                {!layoutsDoCliente.length && (
                  <p className="text-xs text-muted-foreground">
                    Este cliente ainda não tem layouts. Crie um na tela de Visualização.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {!ronda ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                {rondas.isLoading
                  ? "Carregando rondas..."
                  : "Nenhuma ronda ainda. Crie a primeira em “Nova ronda”."}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Sequência da ronda</Label>
                    <div className="flex items-center gap-2">
                      {rodando && (
                        <span className="text-xs text-muted-foreground">
                          Etapa {passo + 1}/{lista.length} · {restante}s
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!layoutAtual}
                        onClick={() => setTelaCheia(true)}
                      >
                        <Maximize2 className="mr-1 h-4 w-4" /> Tela cheia
                      </Button>
                      <Button

                        size="sm"
                        variant="outline"
                        disabled={!rodando || lista.length < 2}
                        onClick={() => setPasso((p) => (p + 1) % lista.length)}
                      >
                        <SkipForward className="mr-1 h-4 w-4" /> Próximo
                      </Button>
                      <Button
                        size="sm"
                        disabled={!lista.length}
                        onClick={() => setRodando((v) => !v)}
                      >
                        {rodando ? (
                          <>
                            <Pause className="mr-1 h-4 w-4" /> Parar
                          </>
                        ) : (
                          <>
                            <Play className="mr-1 h-4 w-4" /> Iniciar
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {!lista.length && (
                    <p className="text-sm text-muted-foreground">
                      Adicione layouts ao lado para montar a sequência.
                    </p>
                  )}

                  <div className="space-y-2">
                    {lista.map((it, i) => {
                      const l = layoutDe(it.layout_id);
                      return (
                        <div
                          key={it.id}
                          className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
                            rodando && i === passo ? "border-primary bg-primary/5" : "border-border"
                          }`}
                        >
                          <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {l
                          ? `${l.nome} · ${mosaicoDe(l.template, l.colunas, l.linhas).nome}`
                          : "Layout removido"}
                          </span>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={3}
                              max={600}
                              value={it.segundos}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                setLista((p) =>
                                  p.map((x, idx) => (idx === i ? { ...x, segundos: v } : x)),
                                );
                                setSujo(true);
                              }}
                              className="h-8 w-20"
                            />
                            <span className="text-xs text-muted-foreground">s</span>
                          </div>
                          <Button size="icon" variant="ghost" onClick={() => mover(i, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => mover(i, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setLista((p) => p.filter((_, idx) => idx !== i));
                              setSujo(true);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {layoutAtual && (
                <div
                  className={
                    telaCheia
                      ? "fixed inset-0 z-50 grid gap-0 bg-black p-0"
                      : "grid gap-0"
                  }
                  style={{
                    gridTemplateColumns: `repeat(${mosaicoAtual.colunas}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${mosaicoAtual.linhas}, minmax(0, 1fr))`,
                    ...(telaCheia
                      ? {}
                      : {
                          aspectRatio: `${mosaicoAtual.colunas * 16} / ${mosaicoAtual.linhas * 9}`,
                        }),
                  }}
                >
                  {mosaicoAtual.celulas.map((cel, i) => {
                    const s = slotsAtuais[i] ?? null;
                    return (
                      <div
                        key={i}
                        style={estiloCelula(cel)}
                        className="relative overflow-hidden bg-black/90"
                      >
                        {s ? (
                          <Tile slot={s} nome={nomeDvr(s.dvr_id)} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/40">
                            <Camera className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {telaCheia && (
                    <button
                      type="button"
                      onClick={() => setTelaCheia(false)}
                      className="fixed right-4 top-4 z-[60] inline-flex items-center gap-1 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/80"
                    >
                      <Minimize2 className="h-4 w-4" /> Sair da tela cheia (Esc)
                    </button>
                  )}
                </div>
              )}


              
            </>
          )}

        </div>
      </div>

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova ronda</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={nomeNova}
              onChange={(e) => setNomeNova(e.target.value)}
              placeholder="Ex.: Ronda noturna"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!nomeNova.trim() || criar.isPending}
              onClick={() => criar.mutate(nomeNova.trim())}
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({
  slot,
  nome,
}: {
  slot: NonNullable<Slot>;
  nome: string;
}) {

  return (
    <div className="group relative h-full w-full">
      {/* A chave garante que ao trocar de etapa o quadro antigo não continue
          visível no lugar da nova câmera. */}
      <CameraAoVivo
        key={`${slot.dvr_id}:${slot.canal}`}
        dvrId={slot.dvr_id}
        canal={slot.canal}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="truncate font-medium">{nome}</span>
        <span className="opacity-70">CH {slot.canal}</span>
      </div>
    </div>
  );
}



