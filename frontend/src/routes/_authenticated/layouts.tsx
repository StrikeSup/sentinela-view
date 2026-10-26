import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, GripVertical, Maximize2, Minimize2, Pencil, Plus, X } from "lucide-react";
import { Paginacao, usePaginacao } from "@/components/Paginacao";

import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery } from "@/lib/queries";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { PageHeader } from "@/components/PageHeader";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { ComboSelect } from "@/components/ComboSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MOSAICOS, codificarCustom, decodificarCustom, estiloCelula, mosaicoAdaptado, mosaicoAutomatico, mosaicoDe, type Celula, type Mosaico } from "@/lib/mosaicos";

export const Route = createFileRoute("/_authenticated/layouts")({
  head: () => ({
    meta: [
      { title: "Layouts — Sentinela VIEW" },
      {
        name: "description",
        content: "Todos os layouts do cliente, com o DVR e a câmera de cada posição.",
      },
      { property: "og:title", content: "Layouts — Sentinela VIEW" },
      {
        property: "og:description",
        content: "Veja layouts padrão e personalizados e quais câmeras estão em cada um.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LayoutsPage,
});

type Slot = { dvr_id: string; canal: number } | null;
type Layout = {
  id: string;
  nome: string;
  cliente_id: string | null;
  template: string | null;
  colunas: number;
  linhas: number;
  slots: Slot[];
  econdos_condominio_id?: string | null;
};

type MosaicoPersonalizado = {
  id: string;
  nome: string;
  cliente_id: string | null;
  colunas: number;
  linhas: number;
  celulas: Celula[];
};

type Coluna = "nome" | "dvrs" | "cameras" | "formato" | "tipo";

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function LayoutsPage() {
  const { clienteId, setClienteId, bloqueado } = useClienteSelecionado();
  const clientes = useQuery(clientesQuery);
  const usaEcondos = (id: string | null) => {
    const c = (clientes.data ?? []).find((x) => x.id === id) as
      | { sistemas?: string[] | null }
      | undefined;
    return (c?.sistemas ?? []).some((s) => s.toUpperCase() === "ECONDOS");
  };
  const dvrs = useQuery(dvrsQuery);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"todos" | "personalizados" | "padroes">("todos");
  const [aberto, setAberto] = useState<Layout | null>(null);
  const [previa, setPrevia] = useState<Layout | null>(null);
  const [previaAoVivo, setPreviaAoVivo] = useState(false);
  const [ampliadaPrevia, setAmpliadaPrevia] = useState<number | null>(null);
  const [editandoAoVivo, setEditandoAoVivo] = useState(false);
  const [editandoAmpliado, setEditandoAmpliado] = useState(false);
  const [editando, setEditando] = useState<Layout | null>(null);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [destinoArraste, setDestinoArraste] = useState<number | null>(null);
  const posicaoArrastada = useRef<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ordem, setOrdem] = useState<{ col: Coluna; asc: boolean }>({ col: "nome", asc: true });
  const qc = useQueryClient();

  useEffect(() => {
    const encerrarArraste = () => {
      posicaoArrastada.current = null;
      setArrastando(null);
      setDestinoArraste(null);
    };
    window.addEventListener("pointerup", encerrarArraste);
    window.addEventListener("pointercancel", encerrarArraste);
    return () => {
      window.removeEventListener("pointerup", encerrarArraste);
      window.removeEventListener("pointercancel", encerrarArraste);
    };
  }, []);

  const layoutsQ = useQuery({
    queryKey: ["layouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .select("id, nome, cliente_id, template, colunas, linhas, slots, econdos_condominio_id" as "*")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((l) => ({
        ...l,
        slots: Array.isArray(l.slots) ? (l.slots as unknown as Slot[]) : [],
      })) as Layout[];
    },
  });

  const mosaicosPersonalizadosQ = useQuery({
    queryKey: ["mosaicos-personalizados"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mosaicos_personalizados")
        .select("id, nome, cliente_id, colunas, linhas, celulas")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((m) => ({
        ...m,
        celulas: Array.isArray(m.celulas) ? (m.celulas as unknown as Celula[]) : [],
      })) as MosaicoPersonalizado[];
    },
  });

  const layouts = useMemo(
    () =>
      (layoutsQ.data ?? []).filter(
        (l) => l.cliente_id === clienteId && semAcento(l.nome).includes(semAcento(busca)),
      ),
    [layoutsQ.data, clienteId, busca],
  );

  const dvrsCliente = useMemo(
    () => (dvrs.data ?? []).filter((d) => d.cliente_id === clienteId),
    [dvrs.data, clienteId],
  );
  const formatosEdicao = useMemo(() => {
    const automatico = mosaicoAutomatico(64);
    const padroes = [{ ...automatico, id: "auto-64", nome: "Automático" }, ...MOSAICOS].map((m) => ({
      value: m.id,
      label: `Padrão · ${m.nome}`,
      mosaico: m,
      template: m.id,
    }));
    const personalizados = (mosaicosPersonalizadosQ.data ?? [])
      .filter((m) => m.cliente_id === clienteId)
      .map((m) => {
        const template = codificarCustom(m.colunas, m.linhas, m.celulas);
        return {
          value: template,
          label: `Personalizado · ${m.nome}`,
          mosaico: { id: template, nome: m.nome, colunas: m.colunas, linhas: m.linhas, celulas: m.celulas } as Mosaico,
          template,
        };
      });
    return [...padroes, ...personalizados];
  }, [clienteId, mosaicosPersonalizadosQ.data]);
  const dvrIds = useMemo(
    () =>
      [
        ...new Set([
          ...layouts.flatMap((l) => (l.slots ?? []).filter(Boolean).map((s) => s!.dvr_id)),
          ...dvrsCliente.map((d) => d.id),
        ]),
      ].sort(),
    [layouts, dvrsCliente],
  );
  const camerasQ = useQuery({
    queryKey: ["cameras-layouts", dvrIds],
    enabled: dvrIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("dvr_id, canal, nome")
        .in("dvr_id", dvrIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const nomeDvr = (id: string) => dvrs.data?.find((d) => d.id === id)?.nome ?? "DVR removido";
  const nomeCamera = (s: NonNullable<Slot>) =>
    camerasQ.data?.find((c) => c.dvr_id === s.dvr_id && c.canal === s.canal)?.nome ||
    `Canal ${s.canal}`;

  const filtrados = layouts.filter((l) => {
    if (tipo === "personalizados") return !!decodificarCustom(l.template);
    if (tipo === "padroes") return !decodificarCustom(l.template);
    return true;
  });
  const infoLinha = (l: Layout) => {
    const dvrsUsados = [...new Set((l.slots ?? []).filter(Boolean).map((s) => s!.dvr_id))];
    const personalizado = !!decodificarCustom(l.template);
    const usadas = (l.slots ?? []).filter(Boolean).length;
    return {
      dvrsUsados,
      personalizado,
      usadas,
      formato: mosaicoAdaptado(l.template, l.colunas, l.linhas, usadas).nome,
    };
  };
  const chave = (l: Layout): string | number => {
    const i = infoLinha(l);
    switch (ordem.col) {
      case "dvrs": return i.dvrsUsados.length;
      case "cameras": return i.usadas;
      case "formato": return i.formato;
      case "tipo": return i.personalizado ? "Personalizado" : "Padrão";
      default: return semAcento(l.nome);
    }
  };
  filtrados.sort((a, b) => {
    const x = chave(a), y = chave(b);
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
    return ordem.asc ? r : -r;
  });
  const alternar = (col: Coluna) =>
    setOrdem((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: true }));
  const Th = ({ col, children, className = "" }: { col: Coluna; children: React.ReactNode; className?: string }) => (
    <th className={`p-2 ${className}`}>
      <button type="button" onClick={() => alternar(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        {ordem.col !== col ? <ArrowUpDown className="h-3 w-3 opacity-50" /> : ordem.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </th>
  );

  const novoLayout = () => {
    const automatico = mosaicoAutomatico(1);
    setEditando({
      id: "",
      nome: "",
      cliente_id: clienteId,
      template: automatico.id,
      colunas: automatico.colunas,
      linhas: automatico.linhas,
      slots: automatico.celulas.map(() => null),
      econdos_condominio_id: null,
    });
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    const nome = editando.nome.trim();
    if (!nome) { toast.error("Informe o nome do layout."); return; }
    setSalvando(true);
    const dados = {
      nome,
      template: editando.template,
      colunas: editando.colunas,
      linhas: editando.linhas,
      slots: editando.slots as never,
      econdos_condominio_id: editando.econdos_condominio_id?.trim() || null,
    };
    const criando = !editando.id;
    const { error } = criando
      ? await supabase
          .from("layouts_visualizacao")
          .insert({ ...dados, cliente_id: clienteId } as never)
      : await supabase
          .from("layouts_visualizacao")
          .update(dados as never)
          .eq("id", editando.id);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar: " + error.message); return; }
    toast.success(criando ? "Layout criado." : "Layout atualizado.");
    setEditando(null);
    qc.invalidateQueries({ queryKey: ["layouts"] });
  };

  const paginacao = usePaginacao(filtrados, 10);
  const {
    visiveis,
    totalPaginas,
    pagina: paginaAtual,
    setPagina,
    porPagina,
    setPorPagina,
    personalizado: porPaginaPersonalizado,
    setPersonalizado,
  } = paginacao;


  const Mapa = ({ l, grande, editavel, aoVivo, className = "" }: { l: Layout; grande?: boolean; editavel?: boolean; aoVivo?: boolean; className?: string }) => {
    const usadas = (l.slots ?? []).filter(Boolean).length;
    const m = mosaicoAdaptado(l.template, l.colunas, l.linhas, usadas);
    return (
      <div
        className={`grid gap-1 rounded-md bg-muted p-1 ${className}`}
        style={{
          gridTemplateColumns: `repeat(${m.colunas}, minmax(0,1fr))`,
          gridTemplateRows: `repeat(${m.linhas}, ${grande ? "minmax(72px,1fr)" : "minmax(34px,1fr)"})`,
          aspectRatio: grande ? undefined : "16 / 9",
        }}
      >
        {m.celulas.map((cel, i) => {
          const s = (l.slots ?? [])[i] ?? null;
          return (
            <div
              key={i}
              style={estiloCelula(cel)}
              onClick={() => {
                if (aoVivo && s) setAmpliadaPrevia(i);
              }}
              onPointerDown={(e) => {
                if (!editavel || e.button !== 0) return;
                e.preventDefault();
                posicaoArrastada.current = i;
                setArrastando(i);
                setDestinoArraste(i);
              }}
              onPointerEnter={() => {
                const origem = posicaoArrastada.current;
                if (!editavel || origem === null || origem === i) return;
                setDestinoArraste(i);
              }}
              onPointerLeave={() => {
                if (posicaoArrastada.current !== null && destinoArraste === i) {
                  setDestinoArraste(null);
                }
              }}
              onPointerUp={(e) => {
                const origem = posicaoArrastada.current;
                if (!editavel || origem === null || origem === i) return;
                e.preventDefault();
                setEditando((atual) => {
                  if (!atual) return atual;
                  const slots = [...atual.slots];
                  while (slots.length < m.celulas.length) slots.push(null);
                  [slots[origem], slots[i]] = [slots[i] ?? null, slots[origem] ?? null];
                  return { ...atual, slots };
                });
                posicaoArrastada.current = null;
                setArrastando(null);
                setDestinoArraste(null);
              }}
              className={`relative flex min-w-0 flex-col justify-center overflow-hidden rounded bg-card px-1.5 text-center ${aoVivo && s ? "cursor-zoom-in" : ""} ${editavel ? "touch-none select-none cursor-grab border border-border transition-[box-shadow,opacity] duration-100 active:cursor-grabbing" : ""} ${arrastando === i ? "z-10 opacity-70 ring-2 ring-primary" : ""} ${arrastando !== null && destinoArraste === i && arrastando !== i ? "ring-2 ring-primary/60" : ""}`}
            >
              {editavel && <GripVertical className="absolute left-1 top-1 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
              {s && aoVivo ? (
                <div className="absolute inset-0 bg-muted-foreground">
                  <CameraAoVivo dvrId={s.dvr_id} canal={s.canal} qualidade="extra" />
                </div>
              ) : s ? (
                <>
                  <span className={`truncate font-medium ${grande ? "text-sm" : "text-[10px]"}`}>
                    {nomeCamera(s)}
                  </span>
                  <span className={`truncate text-muted-foreground ${grande ? "text-xs" : "text-[9px]"}`}>
                    {nomeDvr(s.dvr_id)} · canal {s.canal}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-muted-foreground">{i + 1} · vazia</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const lista = (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">
        Layouts <span className="text-muted-foreground">({filtrados.length})</span>
      </h2>
      {!visiveis.length ? (
        <p className="text-sm text-muted-foreground">Nenhum layout.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <Th col="nome">Nome</Th>
                  <Th col="dvrs">DVRs</Th>
                  <Th col="cameras">Câmeras</Th>
                  <Th col="formato">Formato</Th>
                  <Th col="tipo">Tipo</Th>
                  <th className="p-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const i = infoLinha(l);
                  return (
                    <tr key={l.id} onClick={() => setAberto(l)} className="cursor-pointer border-t hover:bg-muted/60">
                      <td className="p-2 font-medium">{l.nome}</td>
                      <td className="max-w-xs truncate p-2 text-muted-foreground" title={i.dvrsUsados.map(nomeDvr).join(", ")}>
                        {i.dvrsUsados.length ? `${i.dvrsUsados.length} · ${i.dvrsUsados.map(nomeDvr).join(", ")}` : "—"}
                      </td>
                      <td className="p-2">{i.usadas}</td>
                      <td className="p-2"><Badge variant="secondary">{i.formato}</Badge></td>
                      <td className="p-2">
                        <Badge variant={i.personalizado ? "default" : "outline"}>{i.personalizado ? "Personalizado" : "Padrão"}</Badge>
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" onClick={() => { setPrevia(l); setPreviaAoVivo(false); }}>
                            <Eye className="mr-1 h-4 w-4" /> Pré-visualização
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditando({ ...l, slots: [...l.slots] })}>
                            <Pencil className="mr-1 h-4 w-4" /> Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginacao
            total={filtrados.length}
            totalPaginas={totalPaginas}
            pagina={paginaAtual}
            setPagina={setPagina}
            porPagina={porPagina}
            setPorPagina={setPorPagina}
            personalizado={porPaginaPersonalizado}
            setPersonalizado={setPersonalizado}
            rotulo="layouts"
          />

        </>
      )}
    </section>
  );

  const fonteAmpliada = previa ?? editando;
  const slotAmpliado =
    fonteAmpliada && ampliadaPrevia !== null
      ? (fonteAmpliada.slots[ampliadaPrevia] ?? null)
      : null;
  const overlayAmpliada = slotAmpliado
    ? createPortal(
        <div
          className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/95 p-4"
          onClick={() => setAmpliadaPrevia(null)}
          role="dialog"
          aria-label={`Câmera ampliada — ${nomeCamera(slotAmpliado)}`}
        >
          <div className="relative h-full w-full max-w-7xl">
            <CameraAoVivo dvrId={slotAmpliado.dvr_id} canal={slotAmpliado.canal} qualidade="extra" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAmpliadaPrevia(null);
              }}
              title="Fechar"
              aria-label="Fechar câmera ampliada"
              className="absolute right-4 top-4 rounded-sm bg-black/50 p-2 text-white/80 cursor-pointer transition-colors hover:bg-black/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Fechar</span>
            </button>
            <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-white/60">
              Clique fora ou pressione Esc para voltar
            </span>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Layouts"
        description="Todos os layouts do cliente, com o DVR e a câmera de cada posição."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64 space-y-1.5">
          <Label>Cliente</Label>
          <ComboSelect
            value={clienteId}
            onChange={setClienteId}
            disabled={bloqueado}
            options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
            placeholder="Selecione o cliente"
            searchPlaceholder="Pesquisar cliente..."
          />
        </div>
        <div className="w-64 space-y-1.5">
          <Label>Buscar</Label>
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Nome do layout"
          />
        </div>
        <div className="w-48 space-y-1.5">
          <Label>Tipo</Label>
          <ComboSelect
            value={tipo}
            onChange={(v) => {
              setTipo(v as typeof tipo);
              setPagina(1);
            }}
            options={[
              { value: "todos", label: "Todos" },
              { value: "personalizados", label: "Personalizados" },
              { value: "padroes", label: "Padrões" },
            ]}
            placeholder="Todos"
          />
        </div>
        <Button className="ml-auto" disabled={!clienteId} onClick={novoLayout}>
          <Plus className="mr-2 h-4 w-4" /> Novo layout
        </Button>
      </div>

      {!clienteId ? (
        <p className="text-sm text-muted-foreground">Escolha o cliente para ver os layouts.</p>
      ) : (
        lista
      )}

      <Dialog open={!!aberto} onOpenChange={(v) => !v && setAberto(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{aberto?.nome}</DialogTitle>
          </DialogHeader>
          {aberto && (
            <div className="space-y-4">
              <Mapa l={aberto} grande />
              <div className="max-h-64 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2">Posição</th>
                      <th className="p-2">DVR</th>
                      <th className="p-2">Canal</th>
                      <th className="p-2">Câmera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aberto.slots.map((s, i) =>
                      s ? (
                        <tr key={i} className="border-t">
                          <td className="p-2">{i + 1}</td>
                          <td className="p-2">{nomeDvr(s.dvr_id)}</td>
                          <td className="p-2">{s.canal}</td>
                          <td className="p-2">{nomeCamera(s)}</td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previa}
        onOpenChange={(v) => {
          if (!v) {
            setPrevia(null);
            setPreviaAoVivo(false);
            setAmpliadaPrevia(null);
          }
        }}
      >
        <DialogContent
          className="max-w-6xl"
          onEscapeKeyDown={(e) => {
            if (ampliadaPrevia !== null) {
              e.preventDefault();
              setAmpliadaPrevia(null);
            }
          }}
          onPointerDownOutside={(e) => {
            if (ampliadaPrevia !== null) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (ampliadaPrevia !== null) e.preventDefault();
          }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviaAoVivo((v) => !v)}
            title={previaAoVivo ? "Desligar câmeras ao vivo" : "Ver câmeras ao vivo"}
            className="absolute right-12 top-3.5 cursor-pointer"
          >
            Pré-visualização
          </Button>
          <DialogHeader>
            <DialogTitle>Pré-visualização — {previa?.nome}</DialogTitle>
          </DialogHeader>
          {previa && <Mapa l={previa} grande aoVivo={previaAoVivo} />}
        </DialogContent>
      </Dialog>

        <Dialog
        open={!!editando}
        onOpenChange={(v) => {
          if (!v) {
            setEditando(null);
            setEditandoAoVivo(false);
            setEditandoAmpliado(false);
            setAmpliadaPrevia(null);
          }
        }}
      >
        <DialogContent
          className="max-w-4xl"
          onEscapeKeyDown={(e) => {
            if (slotAmpliado || editandoAmpliado) {
              e.preventDefault();
              if (slotAmpliado) setAmpliadaPrevia(null);
              else setEditandoAmpliado(false);
            }
          }}
          onPointerDownOutside={(e) => {
            if (slotAmpliado || editandoAmpliado) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (slotAmpliado || editandoAmpliado) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar layout" : "Novo layout"}</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={editando.nome}
                  maxLength={80}
                  onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                />
              </div>
              {usaEcondos(editando.cliente_id) && (
                <div className="space-y-1.5">
                  <Label>ID do condomínio no eCondos</Label>
                  <Input
                    value={editando.econdos_condominio_id ?? ""}
                    maxLength={120}
                    placeholder="Ex.: 5f3a..."
                    onChange={(e) =>
                      setEditando({ ...editando, econdos_condominio_id: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Formato do mosaico</Label>
                <ComboSelect
                  value={editando.template ?? `${editando.colunas}x${editando.linhas}`}
                  onChange={(value) => {
                    const formato = formatosEdicao.find((item) => item.value === value);
                    const mosaico = formato?.mosaico ?? mosaicoDe(value, editando.colunas, editando.linhas);
                    const removidas = editando.slots.slice(mosaico.celulas.length).filter(Boolean).length;
                    const slots = editando.slots.slice(0, mosaico.celulas.length);
                    while (slots.length < mosaico.celulas.length) slots.push(null);
                    setEditando({
                      ...editando,
                      template: formato?.template ?? value,
                      colunas: mosaico.colunas,
                      linhas: mosaico.linhas,
                      slots,
                    });
                    if (removidas > 0) {
                      toast.info(`${removidas} câmera${removidas > 1 ? "s foram retiradas" : " foi retirada"} para caber no novo mosaico.`);
                    }
                  }}
                  options={formatosEdicao.map(({ value, label }) => ({ value, label }))}
                  placeholder="Escolha o formato"
                  searchPlaceholder="Pesquisar formato..."
                  renderPreview={(op) => {
                    const alvo = op?.value ?? editando.template ?? `${editando.colunas}x${editando.linhas}`;
                    const m = formatosEdicao.find((f) => f.value === alvo)?.mosaico;
                    if (!m) return null;
                    return (
                      <div
                        className="grid w-full gap-0.5 rounded-md bg-muted p-1"
                        style={{
                          gridTemplateColumns: `repeat(${m.colunas}, minmax(0,1fr))`,
                          aspectRatio: "16 / 9",
                        }}
                      >
                        {m.celulas.map((cel, i) => (
                          <div
                            key={i}
                            className="rounded-[2px] border border-border bg-card"
                            style={estiloCelula(cel)}
                          />
                        ))}
                      </div>
                    );
                  }}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">
                  <Label>Câmeras por posição</Label>
                  {mosaicoAdaptado(editando.template, editando.colunas, editando.linhas, editando.slots.filter(Boolean).length).celulas.map((_, i) => {
                    const s = editando.slots[i] ?? null;
                    const dvr = dvrsCliente.find((d) => d.id === s?.dvr_id);
                    const canais = Math.max(1, Number(dvr?.canais ?? 0) || 32);
                    const mudar = (novo: Slot) => {
                      const slots = [...editando.slots];
                      while (slots.length <= i) slots.push(null);
                      slots[i] = novo;
                      setEditando({ ...editando, slots });
                    };
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
                        <div className="flex-1">
                          <ComboSelect
                            value={s?.dvr_id ?? ""}
                            onChange={(v) => mudar(v ? { dvr_id: v, canal: 1 } : null)}
                            options={[{ value: "", label: "— vazia —" }, ...dvrsCliente.map((d) => ({ value: d.id, label: d.nome }))]}
                            placeholder="DVR"
                            searchPlaceholder="Pesquisar DVR..."
                          />
                        </div>
                        <div className="flex-1">
                          <ComboSelect
                            value={s ? String(s.canal) : ""}
                            disabled={!s}
                            onChange={(v) => s && mudar({ dvr_id: s.dvr_id, canal: Number(v) })}
                            options={Array.from({ length: canais }, (_, k) => {
                              const c = k + 1;
                              const n = camerasQ.data?.find((x) => x.dvr_id === s?.dvr_id && x.canal === c)?.nome;
                              return { value: String(c), label: n ? `${c} · ${n}` : `Canal ${c}` };
                            })}
                            placeholder="Canal"
                            searchPlaceholder="Pesquisar câmera..."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Como vai ficar</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditandoAoVivo((v) => !v)}
                        title={editandoAoVivo ? "Desligar câmeras ao vivo" : "Ver câmeras ao vivo"}
                      >
                        Pré-visualização
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setEditandoAmpliado(true)}
                        title="Ampliar visualização"
                        aria-label="Ampliar visualização"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Mapa l={editando} grande editavel aoVivo={editandoAoVivo} />
                  <p className="text-xs text-muted-foreground">Arraste uma câmera para trocar sua posição.</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                <Button onClick={salvarEdicao} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {editando &&
        editandoAmpliado &&
        createPortal(
          <div
            className="pointer-events-auto fixed inset-0 z-[70] flex flex-col bg-background/95 p-4"
            onClick={() => {
              setEditandoAmpliado(false);
              setAmpliadaPrevia(null);
            }}
            role="dialog"
            aria-label="Visualização ampliada do layout"
          >
            <div
              className="relative mx-auto flex h-full w-full max-w-7xl flex-col gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Como vai ficar — {editando.nome}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditandoAoVivo((v) => !v)}
                    title={editandoAoVivo ? "Desligar câmeras ao vivo" : "Ver câmeras ao vivo"}
                  >
                    Pré-visualização
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      setEditandoAmpliado(false);
                      setAmpliadaPrevia(null);
                    }}
                    title="Voltar"
                    aria-label="Voltar à visualização normal"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="relative min-h-0 flex-1">
                <div className="flex h-full justify-center">
                  <Mapa l={editando} grande editavel aoVivo={editandoAoVivo} className="h-full w-full" />
                </div>
                <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-muted-foreground">
                  Arraste uma câmera para trocar sua posição. Clique fora ou pressione Esc para voltar.
                </p>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {overlayAmpliada}
    </div>
  );
}
