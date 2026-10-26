import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { PageHeader } from "@/components/PageHeader";
import { AjudaJanela } from "@/components/AjudaJanela";
import { ComboSelect } from "@/components/ComboSelect";
import {
  LayoutCameraSelector,
  type LayoutCameraSlot,
} from "@/components/LayoutCameraSelector";
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
  MOSAICOS,
  codificarCustom,
  estiloCelula,
  mosaicoAutomatico,
  type Celula,
  type Mosaico,
} from "@/lib/mosaicos";
import { Plus, Copy, Trash2, Pencil, Grid2x2, MonitorPlay } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/mosaicos")({
  head: () => ({
    meta: [
      { title: "Mosaicos — Sentinela VIEW" },
      {
        name: "description",
        content:
          "Monte o formato do mosaico de câmeras: use os modelos prontos ou crie um personalizado para cada cliente.",
      },
      { property: "og:title", content: "Mosaicos — Sentinela VIEW" },
      {
        property: "og:description",
        content: "Modelos prontos e formatos personalizados de mosaico por cliente.",
      },
    ],
  }),
  component: MosaicosPage,
});

type MosaicoCustom = {
  id: string;
  cliente_id: string | null;
  nome: string;
  colunas: number;
  linhas: number;
  celulas: Celula[];
};

const mosaicosQuery = {
  queryKey: ["mosaicos-personalizados"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("mosaicos_personalizados")
      .select("*")
      .order("nome");
    if (error) throw error;
    return (data ?? []).map((m) => ({
      ...m,
      celulas: Array.isArray(m.celulas) ? (m.celulas as unknown as Celula[]) : [],
    })) as MosaicoCustom[];
  },
};

/* ---------- Prévia ---------- */

export function PreviaMosaico({
  mosaico,
  ativo,
  numerado,
}: {
  mosaico: Mosaico;
  ativo?: boolean;
  numerado?: boolean;
}) {
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
          className={`flex items-center justify-center rounded-[3px] text-[10px] font-medium ${
            ativo ? "bg-primary/70 text-primary-foreground" : "bg-muted-foreground/25 text-foreground/70"
          }`}
        >
          {numerado ? i + 1 : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- Editor de formato ---------- */

function gradeSimples(colunas: number, linhas: number): Celula[] {
  const out: Celula[] = [];
  for (let r = 1; r <= linhas; r++) for (let c = 1; c <= colunas; c++) out.push({ c, r, cs: 1, rs: 1 });
  return out;
}

function ordenar(celulas: Celula[]) {
  return [...celulas].sort((a, b) => (a.r - b.r) || (a.c - b.c));
}

function cobre(cel: Celula, c: number, r: number) {
  return c >= cel.c && c < cel.c + cel.cs && r >= cel.r && r < cel.r + cel.rs;
}

function EditorMosaico({
  colunas,
  linhas,
  celulas,
  onChange,
}: {
  colunas: number;
  linhas: number;
  celulas: Celula[];
  onChange: (c: Celula[]) => void;
}) {
  const [inicio, setInicio] = useState<{ c: number; r: number } | null>(null);
  const [fim, setFim] = useState<{ c: number; r: number } | null>(null);

  const retangulo = useMemo(() => {
    if (!inicio || !fim) return null;
    const c = Math.min(inicio.c, fim.c);
    const r = Math.min(inicio.r, fim.r);
    return { c, r, cs: Math.abs(inicio.c - fim.c) + 1, rs: Math.abs(inicio.r - fim.r) + 1 };
  }, [inicio, fim]);

  const finalizar = () => {
    if (!retangulo) return;
    setInicio(null);
    setFim(null);
    if (retangulo.cs === 1 && retangulo.rs === 1) {
      // clique simples: desfaz o bloco daquela posição
      const bloco = celulas.find((cel) => cobre(cel, retangulo.c, retangulo.r));
      if (!bloco || (bloco.cs === 1 && bloco.rs === 1)) return;
      const resto = celulas.filter((cel) => cel !== bloco);
      for (let r = bloco.r; r < bloco.r + bloco.rs; r++)
        for (let c = bloco.c; c < bloco.c + bloco.cs; c++) resto.push({ c, r, cs: 1, rs: 1 });
      onChange(ordenar(resto));
      return;
    }
    // junta os quadradinhos da área selecionada num bloco único
    const restantes: Celula[] = [];
    for (const cel of celulas) {
      let dentro = false;
      for (let r = cel.r; r < cel.r + cel.rs && !dentro; r++)
        for (let c = cel.c; c < cel.c + cel.cs && !dentro; c++)
          if (
            c >= retangulo.c &&
            c < retangulo.c + retangulo.cs &&
            r >= retangulo.r &&
            r < retangulo.r + retangulo.rs
          )
            dentro = true;
      if (!dentro) restantes.push(cel);
      else {
        // pedaços do bloco que ficaram fora da área voltam a ser 1x1
        for (let r = cel.r; r < cel.r + cel.rs; r++)
          for (let c = cel.c; c < cel.c + cel.cs; c++) {
            const naArea =
              c >= retangulo.c &&
              c < retangulo.c + retangulo.cs &&
              r >= retangulo.r &&
              r < retangulo.r + retangulo.rs;
            if (!naArea) restantes.push({ c, r, cs: 1, rs: 1 });
          }
      }
    }
    onChange(ordenar([...restantes, retangulo]));
  };

  const unidades: { c: number; r: number }[] = [];
  for (let r = 1; r <= linhas; r++) for (let c = 1; c <= colunas; c++) unidades.push({ c, r });

  return (
    <div
      className="relative select-none"
      onMouseLeave={() => {
        setInicio(null);
        setFim(null);
      }}
      onMouseUp={finalizar}
    >
      <div
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${linhas}, minmax(0, 1fr))`,
          aspectRatio: `${colunas * 16} / ${linhas * 9}`,
        }}
      >
        {celulas.map((cel, i) => (
          <div
            key={`${cel.c}-${cel.r}-${i}`}
            style={estiloCelula(cel)}
            className="flex items-center justify-center rounded-[4px] bg-muted-foreground/25 text-xs font-medium text-foreground/70"
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* camada invisível para clicar e arrastar sobre os quadradinhos */}
      <div
        className="absolute inset-0 grid gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${linhas}, minmax(0, 1fr))`,
        }}
      >
        {unidades.map((u) => {
          const marcado =
            retangulo &&
            u.c >= retangulo.c &&
            u.c < retangulo.c + retangulo.cs &&
            u.r >= retangulo.r &&
            u.r < retangulo.r + retangulo.rs;
          return (
            <div
              key={`${u.c}-${u.r}`}
              onMouseDown={() => {
                setInicio(u);
                setFim(u);
              }}
              onMouseEnter={() => inicio && setFim(u)}
              className={`rounded-[4px] transition ${
                marcado ? "bg-primary/60 ring-2 ring-primary" : "hover:bg-primary/15"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function EditorDialog({
  open,
  onOpenChange,
  inicial,
  pendente,
  onSalvar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inicial: MosaicoCustom | null;
  pendente: boolean;
  onSalvar: (v: { nome: string; colunas: number; linhas: number; celulas: Celula[] }) => void;
}) {
  const [nome, setNome] = useState("");
  const [colunas, setColunas] = useState(4);
  const [linhas, setLinhas] = useState(4);
  const [celulas, setCelulas] = useState<Celula[]>(() => gradeSimples(4, 4));

  useEffect(() => {
    if (!open) return;
    setNome(inicial?.nome ?? "");
    const co = inicial?.colunas ?? 4;
    const li = inicial?.linhas ?? 4;
    setColunas(co);
    setLinhas(li);
    setCelulas(inicial?.celulas?.length ? inicial.celulas : gradeSimples(co, li));
  }, [open, inicial]);

  const trocarDimensao = (co: number, li: number) => {
    setColunas(co);
    setLinhas(li);
    setCelulas(gradeSimples(co, li));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-7">
            <DialogTitle>{inicial ? "Editar formato" : "Novo formato personalizado"}</DialogTitle>
            <AjudaJanela
              rota="/mosaicos/novo-formato"
              titulo="Criar formato personalizado"
              aberto={open}
            />
          </div>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[240px_1fr]" data-ajuda="formato-personalizado">
          <div className="space-y-4">
            <div className="space-y-2" data-ajuda="formato-nome">
              <Label>Nome</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Portaria destaque"
              />
            </div>
            <div className="grid grid-cols-2 gap-3" data-ajuda="formato-dimensoes">
              <div className="space-y-2">
                <Label>Colunas</Label>
                <Input
                  type="number"
                  min={2}
                  max={16}
                  value={colunas}
                  onChange={(e) =>
                    trocarDimensao(Math.min(16, Math.max(2, Number(e.target.value) || 2)), linhas)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Linhas</Label>
                <Input
                  type="number"
                  min={2}
                  max={16}
                  value={linhas}
                  onChange={(e) =>
                    trocarDimensao(colunas, Math.min(16, Math.max(2, Number(e.target.value) || 2)))
                  }
                />
              </div>
            </div>
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Clique e arraste sobre os quadradinhos para juntá-los num quadro maior. Clique em cima de
              um quadro grande para desfazer.
            </p>
            <Button
              variant="outline"
              data-ajuda="formato-recomecar"
              onClick={() => setCelulas(gradeSimples(colunas, linhas))}
            >
              Recomeçar
            </Button>
          </div>

          <div className="rounded-lg border border-border p-3" data-ajuda="formato-grade">
            <EditorMosaico
              colunas={colunas}
              linhas={linhas}
              celulas={celulas}
              onChange={setCelulas}
            />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {celulas.length} posição{celulas.length > 1 ? "ões" : ""} de câmera
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            data-ajuda="formato-salvar"
            disabled={!nome.trim() || pendente || celulas.length === 0}
            onClick={() => onSalvar({ nome: nome.trim(), colunas, linhas, celulas })}
          >
            Salvar formato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Página ---------- */

function MosaicosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clienteId, setClienteId, clientes: clientesPermitidos, bloqueado } =
    useClienteSelecionado();
  const clientes = useQuery(clientesQuery);
  const dvrs = useQuery(dvrsQuery);
  const customs = useQuery(mosaicosQuery);

  const [editorAberto, setEditorAberto] = useState(false);
  const [editando, setEditando] = useState<MosaicoCustom | null>(null);
  const [usar, setUsar] = useState<{ template: string; colunas: number; linhas: number } | null>(
    null,
  );
  const [nomeLayout, setNomeLayout] = useState("");
  const [dvrIdsLayout, setDvrIdsLayout] = useState<string[]>([]);
  const [camerasLayout, setCamerasLayout] = useState<LayoutCameraSlot[]>([]);

  const opcoesCliente = useMemo(
    () =>
      (clientes.data ?? [])
        .filter((c) => clientesPermitidos.some((p) => p.id === c.id))
        .map((c) => ({ value: c.id, label: c.nome })),
    [clientes.data, clientesPermitidos],
  );

  const meus = useMemo(
    () => (customs.data ?? []).filter((m) => !clienteId || m.cliente_id === clienteId),
    [customs.data, clienteId],
  );
  const dvrsDoCliente = useMemo(
    () =>
      (dvrs.data ?? [])
        .filter((dvr) => dvr.cliente_id === clienteId)
        .map((dvr) => ({ id: dvr.id, nome: dvr.nome, canais: dvr.canais })),
    [clienteId, dvrs.data],
  );

  const salvarCustom = useMutation({
    mutationFn: async (v: { nome: string; colunas: number; linhas: number; celulas: Celula[] }) => {
      const payload = {
        nome: v.nome,
        colunas: v.colunas,
        linhas: v.linhas,
        celulas: JSON.parse(JSON.stringify(v.celulas)) as Json,
        cliente_id: clienteId || null,
      };
      if (editando) {
        const { error } = await supabase
          .from("mosaicos_personalizados")
          .update(payload)
          .eq("id", editando.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("mosaicos_personalizados")
          .insert({ ...payload, criado_por: user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mosaicos-personalizados"] });
      setEditorAberto(false);
      setEditando(null);
      toast.success("Formato salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicar = useMutation({
    mutationFn: async (m: MosaicoCustom) => {
      const { error } = await supabase.from("mosaicos_personalizados").insert({
        nome: `${m.nome} (cópia)`,
        colunas: m.colunas,
        linhas: m.linhas,
        celulas: JSON.parse(JSON.stringify(m.celulas)) as Json,
        cliente_id: m.cliente_id,
        criado_por: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mosaicos-personalizados"] });
      toast.success("Formato duplicado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("mosaicos_personalizados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mosaicos-personalizados"] });
      toast.success("Formato excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarLayout = useMutation({
    mutationFn: async () => {
      if (!usar) return;
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .insert({
          nome: nomeLayout.trim(),
          colunas: usar.colunas,
          linhas: usar.linhas,
          template: usar.template,
          slots: JSON.parse(JSON.stringify(camerasLayout)) as Json,
          cliente_id: clienteId || null,
          criado_por: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layouts"] });
      setUsar(null);
      setNomeLayout("");
      setDvrIdsLayout([]);
      setCamerasLayout([]);
      toast.success("Layout criado");
      navigate({ to: "/visualizacao" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cartao = (
    chave: string,
    mosaico: Mosaico,
    titulo: string,
    subtitulo: string,
    template: string,
    acoes?: React.ReactNode,
  ) => (
    <Card key={chave} className="overflow-hidden">
      <CardContent className="space-y-3 p-3">
        <PreviaMosaico mosaico={mosaico} />
        <div>
          <p className="truncate text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={!clienteId}
            onClick={() => {
              setUsar({ template, colunas: mosaico.colunas, linhas: mosaico.linhas });
              setNomeLayout("");
              setDvrIdsLayout([]);
              setCamerasLayout([]);
            }}
          >
            <MonitorPlay className="mr-1.5 h-3.5 w-3.5" /> Usar
          </Button>
          {acoes}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mosaicos"
        description="Escolha um formato pronto ou monte o seu para o cliente."
        actions={
          <Button
            disabled={!clienteId}
            onClick={() => {
              setEditando(null);
              setEditorAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Novo formato
          </Button>
        }
      />

      <Card>
        <CardContent className="max-w-sm space-y-2 p-4">
          <Label>Cliente</Label>
          <ComboSelect
            value={clienteId}
            onChange={setClienteId}
            disabled={bloqueado}
            options={opcoesCliente}
            placeholder="Selecione o cliente"
            searchPlaceholder="Pesquisar cliente..."
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Grid2x2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Formatos personalizados do cliente</h2>
        </div>
        {!clienteId ? (
          <p className="text-sm text-muted-foreground">Selecione um cliente para ver os formatos.</p>
        ) : meus.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum formato personalizado ainda. Clique em “Novo formato” para montar o seu.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {meus.map((m) =>
              cartao(
                m.id,
                { id: m.id, nome: m.nome, colunas: m.colunas, linhas: m.linhas, celulas: m.celulas },
                m.nome,
                `${m.celulas.length} câmeras · ${m.colunas}×${m.linhas}`,
                codificarCustom(m.colunas, m.linhas, m.celulas),
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Editar"
                    onClick={() => {
                      setEditando(m);
                      setEditorAberto(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Duplicar"
                    onClick={() => duplicar.mutate(m)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Excluir"
                    onClick={() => {
                      if (confirm(`Excluir o formato "${m.nome}"?`)) excluir.mutate(m.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>,
              ),
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Grid2x2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Formatos prontos</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cartao(
            "auto",
            mosaicoAutomatico(6),
            "Automático",
            "A grade se ajusta às câmeras",
            "auto-64",
          )}
          {MOSAICOS.map((m) =>
            cartao(m.id, m, m.nome, `${m.celulas.length} câmeras`, m.id),
          )}
        </div>
      </section>

      <EditorDialog
        open={editorAberto}
        onOpenChange={(v) => {
          setEditorAberto(v);
          if (!v) setEditando(null);
        }}
        inicial={editando}
        pendente={salvarCustom.isPending}
        onSalvar={(v) => salvarCustom.mutate(v)}
      />

      <Dialog
        open={!!usar}
        onOpenChange={(v) => {
          if (v) return;
          setUsar(null);
          setDvrIdsLayout([]);
          setCamerasLayout([]);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Criar layout com este formato</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome do layout</Label>
            <Input
              value={nomeLayout}
              onChange={(e) => setNomeLayout(e.target.value)}
              placeholder="Ex.: Portaria"
            />
          </div>
          {usar && (
            <LayoutCameraSelector
              dvrs={dvrsDoCliente}
              dvrIds={dvrIdsLayout}
              onDvrIdsChange={setDvrIdsLayout}
              cameras={camerasLayout}
              onCamerasChange={setCamerasLayout}
              limite={usar.template.startsWith("auto") ? 64 : Math.max(1, (() => {
                const custom = usar.template.startsWith("custom:")
                  ? usar.template.split(":")[2]?.split("_").length
                  : MOSAICOS.find((m) => m.id === usar.template)?.celulas.length;
                return custom ?? usar.colunas * usar.linhas;
              })())}
            />
          )}
          <DialogFooter>
            <Button
              disabled={!nomeLayout.trim() || criarLayout.isPending}
              onClick={() => criarLayout.mutate()}
            >
              Criar e abrir na Visualização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
