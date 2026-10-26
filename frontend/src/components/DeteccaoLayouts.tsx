import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";


import { supabase } from "@/integrations/supabase/client";
import { clientesQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { mosaicoDe } from "@/lib/mosaicos";
import { ComboSelect } from "@/components/ComboSelect";
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

export type LayoutDeteccao = {
  id: string;
  nome: string;
  cliente_id: string | null;
  template: string | null;
  retencao_segundos: number | null;
  ativo: boolean;
};

type LayoutVisualizacao = {
  id: string;
  nome: string;
  cliente_id: string | null;
  template: string | null;
  colunas: number;
  linhas: number;
  slots: unknown;
};

export function layoutsDeteccaoQuery(clienteId: string | null) {
  return {
    queryKey: ["layouts-deteccao", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_deteccao" as never)
        .select("id, nome, cliente_id, template, retencao_segundos, ativo")
        .eq("cliente_id", clienteId ?? "")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LayoutDeteccao[];
    },
  };
}

/* Renderiza os botões na mesma linha do título da página (portal no PageHeader). */
function AcoesDeteccao({ children }: { children: React.ReactNode }) {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setAlvo(document.getElementById("acoes-deteccao"));
  }, []);
  if (!alvo) return null;
  return createPortal(<div className="flex flex-wrap justify-end gap-2">{children}</div>, alvo);
}

export function DeteccaoLayouts({ layoutInicialId }: { layoutInicialId?: string }) {

  const qc = useQueryClient();
  const { can, user } = useAuth();
  const podeEditar = can("deteccao.editar");
  const { clienteId, setClienteId, bloqueado } = useClienteSelecionado();
  const clientes = useQuery(clientesQuery);

  const layoutsQ = useQuery({
    queryKey: ["layouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .select("id, nome, cliente_id, template, colunas, linhas, slots")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LayoutVisualizacao[];
    },
  });
  const deteccoesQ = useQuery(layoutsDeteccaoQuery(clienteId));
  const deteccoes = deteccoesQ.data ?? [];
  const layoutsDoCliente = useMemo(
    () => (layoutsQ.data ?? []).filter((layout) => layout.cliente_id === clienteId),
    [layoutsQ.data, clienteId],
  );

  const [deteccaoId, setDeteccaoId] = useState<string | null>(null);
  useEffect(() => {
    if (layoutInicialId && deteccoes.some((item) => item.id === layoutInicialId)) {
      setDeteccaoId(layoutInicialId);
      return;
    }
    if (!deteccaoId || !deteccoes.some((item) => item.id === deteccaoId)) {
      setDeteccaoId(deteccoes[0]?.id ?? null);
    }
  }, [deteccoes, deteccaoId, layoutInicialId]);

  const deteccao = deteccoes.find((item) => item.id === deteccaoId) ?? null;
  const [lista, setLista] = useState<string[]>([]);
  const [sujo, setSujo] = useState(false);
  const [addLayout, setAddLayout] = useState("");
  const [retencao, setRetencao] = useState("15");
  useEffect(() => {
    try {
      const salva = JSON.parse(deteccao?.template ?? "[]") as unknown;
      setLista(Array.isArray(salva) ? salva.filter((id): id is string => typeof id === "string") : []);
    } catch {
      setLista([]);
    }
    setSujo(false);
  }, [deteccao?.id, deteccao?.template]);
  useEffect(() => {
    setRetencao(
      deteccao?.retencao_segundos != null ? String(deteccao.retencao_segundos) : "",
    );
  }, [deteccao?.id, deteccao?.retencao_segundos]);

  const [novoAberto, setNovoAberto] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [retencaoNova, setRetencaoNova] = useState("15");

  const criar = useMutation({
    mutationFn: async () => {
      const segundos = retencaoNova.trim() === "" ? null : Math.max(0, Number(retencaoNova) || 0);
      const { data, error } = await supabase
        .from("layouts_deteccao" as never)
        .insert({
          nome: nomeNovo.trim(),
          cliente_id: clienteId,
          retencao_segundos: segundos,
          criado_por: user?.id ?? null,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["layouts-deteccao"] });
      qc.invalidateQueries({ queryKey: ["layouts-deteccao-todos"] });
      setDeteccaoId(data.id);
      setNovoAberto(false);
      setNomeNovo("");
      toast.success("Detecção criada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!deteccao) return;
      const segundos = retencao.trim() === "" ? null : Math.max(0, Number(retencao) || 0);
      const { error: atualizacaoErro } = await supabase
        .from("layouts_deteccao" as never)
        .update({ retencao_segundos: segundos, template: JSON.stringify(lista) } as never)
        .eq("id", deteccao.id);
      if (atualizacaoErro) throw atualizacaoErro;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layouts-deteccao"] });
      qc.invalidateQueries({ queryKey: ["layouts-deteccao-todos"] });
      setSujo(false);
      toast.success("Detecção salva.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      if (!deteccao) return;
      const { error } = await supabase
        .from("layouts_deteccao" as never)
        .delete()
        .eq("id", deteccao.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layouts-deteccao"] });
      qc.invalidateQueries({ queryKey: ["layouts-deteccao-todos"] });
      setDeteccaoId(null);
      toast.success("Detecção excluída.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const layoutDe = (id: string) => layoutsDoCliente.find((layout) => layout.id === id) ?? null;
  const opcoesLayouts = layoutsDoCliente.filter(
    (layout) => !lista.includes(layout.id),
  );
  const adicionar = () => {
    if (!addLayout || !deteccao) return;
    setLista((atual) => [...atual, addLayout]);
    setAddLayout("");
    setSujo(true);
  };
  const mover = (indice: number, direcao: -1 | 1) => {
    const destino = indice + direcao;
    if (destino < 0 || destino >= lista.length) return;
    setLista((atual) => {
      const proxima = [...atual];
      const origem = proxima[indice];
      const alvo = proxima[destino];
      if (!origem || !alvo) return atual;
      proxima[indice] = alvo;
      proxima[destino] = origem;
      return proxima;
    });
    setSujo(true);
  };

  return (
    <>
      <AcoesDeteccao>
        <Button
          variant="outline"
          disabled={!clienteId || !podeEditar}
          onClick={() => setNovoAberto(true)}
        >
          <Plus className="mr-2 h-4 w-4" /> Nova detecção
        </Button>
        {deteccao && podeEditar && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (confirm(`Excluir a detecção "${deteccao.nome}"?`)) excluir.mutate();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </Button>
            <Button disabled={!sujo || salvar.isPending} onClick={() => salvar.mutate()}>
              <Save className="mr-2 h-4 w-4" /> Salvar detecção
            </Button>
          </>
        )}
      </AcoesDeteccao>


      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <Label>Cliente</Label>
              <ComboSelect
                value={clienteId}
                onChange={setClienteId}
                disabled={bloqueado}
                options={(clientes.data ?? []).map((cliente) => ({
                  value: cliente.id,
                  label: cliente.nome,
                }))}
                placeholder="Selecione o cliente"
                searchPlaceholder="Pesquisar cliente..."
              />
              <Label>Detecção</Label>
              <ComboSelect
                value={deteccaoId ?? ""}
                onChange={setDeteccaoId}
                disabled={!clienteId}
                options={deteccoes.map((item) => ({ value: item.id, label: item.nome }))}
                placeholder={clienteId ? "Selecione uma detecção" : "Escolha o cliente primeiro"}
                searchPlaceholder="Pesquisar detecção..."
              />
              {sujo && (
                <p className="text-xs text-muted-foreground">
                  Há alterações não salvas. Clique em “Salvar detecção”.
                </p>
              )}
            </CardContent>
          </Card>

          {deteccao && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Label>Adicionar layout à detecção</Label>
                <ComboSelect
                  value={addLayout}
                  onChange={setAddLayout}
                  options={opcoesLayouts.map((layout) => ({
                    value: layout.id,
                    label: `${layout.nome} · ${mosaicoDe(layout.template, layout.colunas, layout.linhas).nome}`,
                  }))}
                  placeholder="Escolha o layout"
                  searchPlaceholder="Pesquisar layout..."
                />
                <Button className="w-full" disabled={!addLayout || !podeEditar} onClick={adicionar}>
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

        <Card>
          <CardContent className="space-y-2 p-4">
            {!deteccao ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma detecção selecionada. Crie a primeira em “Nova detecção”.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Sequência da detecção</Label>
                  <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-xs text-muted-foreground">
                      Retenção
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={3600}
                      value={retencao}
                      disabled={!podeEditar}
                      placeholder="Vazio"
                      className="h-8 w-20"
                      onChange={(event) => {
                        setRetencao(event.target.value);
                        setSujo(true);
                      }}
                    />
                    <span className="text-xs text-muted-foreground">s</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  O primeiro layout fica visível até uma câmera com movimento trocar a sequência.
                </p>

                {!lista.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Adicione layouts ao lado para montar a sequência.
                  </p>
                )}

                <div className="space-y-2">
                  {lista.map((layoutId, indice) => {
                    const layout = layoutDe(layoutId);
                    return (
                      <div
                        key={layoutId}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                      >
                        <span className="w-6 text-center text-xs text-muted-foreground">
                          {indice + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {layout
                            ? `${layout.nome} · ${mosaicoDe(layout.template, layout.colunas, layout.linhas).nome}`
                            : "Layout removido"}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!podeEditar || indice === 0}
                          onClick={() => mover(indice, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!podeEditar || indice === lista.length - 1}
                          onClick={() => mover(indice, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!podeEditar}
                          onClick={() => {
                            setLista((atual) => atual.filter((_, i) => i !== indice));
                            setSujo(true);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova detecção</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={nomeNovo}
                onChange={(event) => setNomeNovo(event.target.value)}
                placeholder="Ex.: Detecção dos condomínios"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tempo de retenção (segundos)</Label>
              <Input
                type="number"
                min={0}
                value={retencaoNova}
                onChange={(event) => setRetencaoNova(event.target.value)}
                placeholder="Em branco: espera o próximo movimento"
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!nomeNovo.trim() || criar.isPending} onClick={() => criar.mutate()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}