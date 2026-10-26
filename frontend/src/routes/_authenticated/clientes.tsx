import { Switch } from "@/components/ui/switch";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery, servidoresQuery, sistemasQuery } from "@/lib/queries";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";
import { PageHeader } from "@/components/PageHeader";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { PERMISSOES } from "@/lib/auth";
import {
  TIPOS_DETECCAO,
  contarDeteccoesAtivas,
  regraDe,
  type DeteccoesCliente,
  type RegraDeteccao,
} from "@/lib/tipos-deteccao";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Lock, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SortHeader, comparar, type Ordem } from "@/components/SortHeader";
import { useMemo } from "react";
import { Paginacao, usePaginacao } from "@/components/Paginacao";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Sentinela VIEW" },
      {
        name: "description",
        content: "Cadastro de clientes, limites de servidores e licenças de DVR.",
      },
      { property: "og:title", content: "Clientes — Sentinela VIEW" },
      { property: "og:description", content: "Cadastro de clientes e limites de licenças." },
    ],
  }),
  component: ClientesPage,
});

type Form = {
  id?: string;
  nome: string;
  documento: string;
  contato_nome: string;
  contato_email: string;
  contato_telefone: string;
  max_servidores: number;
  max_licencas_dvr: number;
  ativo: boolean;
  restringir: boolean;
  permissoes: string[];
  deteccoes: Record<string, RegraDeteccao>;
  sistemas: string[];
  carga_failover_ativo: boolean;
  max_grupos_failover: number;
};

// Cliente sem configuração salva = todos os tipos liberados, sem limite.
function deteccoesDoForm(d: DeteccoesCliente): Record<string, RegraDeteccao> {
  return Object.fromEntries(TIPOS_DETECCAO.map((t) => [t.value, regraDe(d, t.value)]));
}

const vazio: Form = {
  nome: "",
  documento: "",
  contato_nome: "",
  contato_email: "",
  contato_telefone: "",
  max_servidores: 1,
  max_licencas_dvr: 0,
  ativo: true,
  restringir: false,
  permissoes: [],
  deteccoes: deteccoesDoForm(null),
  sistemas: [],
  carga_failover_ativo: false,
  max_grupos_failover: 1,
};

function ClientesPage() {
  const { isMaster } = useAuth();
  const qc = useQueryClient();
  const clientes = useQuery(clientesQuery);
  const servidores = useQuery(servidoresQuery);
  const dvrs = useQuery(dvrsQuery);
  const sistemas = useQuery(sistemasQuery);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const emUso = useQuery({
    queryKey: ["deteccoes-em-uso", form.id],
    enabled: aberto && !!form.id,
    queryFn: () => contarDeteccoesAtivas(form.id!),
  });
  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("todos");
  const [ordem, setOrdem] = useState<
    Ordem<"nome" | "contato" | "servidores" | "licencas" | "ativo">
  >({
    campo: "nome",
    asc: true,
  });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const payload = {
        nome: f.nome,
        documento: f.documento || null,
        contato_nome: f.contato_nome || null,
        contato_email: f.contato_email || null,
        contato_telefone: f.contato_telefone || null,
        max_servidores: f.max_servidores,
        max_licencas_dvr: f.max_licencas_dvr,
        ativo: f.ativo,
        permissoes_permitidas: f.restringir ? f.permissoes : null,
        deteccoes: f.deteccoes,
        sistemas: f.sistemas,
        carga_failover_ativo: f.carga_failover_ativo,
        max_grupos_failover: Math.max(1, f.max_grupos_failover || 1),
      } as never;
      const res = f.id
        ? await supabase.from("clientes").update(payload).eq("id", f.id)
        : await supabase.from("clientes").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success("Cliente salvo");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente excluído");
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const contarServidores = (id: string) =>
    (servidores.data ?? []).filter((s) => s.cliente_id === id).length;
  const contarDvrs = (id: string) => (dvrs.data ?? []).filter((d) => d.cliente_id === id).length;

  const lista = useMemo(() => {
    const termo = busca
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return (clientes.data ?? [])
      .filter((c) => (filtroCliente === "todos" ? true : c.id === filtroCliente))
      .filter((c) =>
        termo
          ? [c.nome, c.documento, c.contato_nome, c.contato_email, c.contato_telefone]
              .filter(Boolean)
              .some((v) =>
                String(v)
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .includes(termo),
              )
          : true,
      )
      .sort((a, b) => {
        const val = (c: typeof a) =>
          ordem.campo === "nome"
            ? c.nome
            : ordem.campo === "contato"
              ? (c.contato_nome ?? "")
              : ordem.campo === "servidores"
                ? contarServidores(c.id)
                : ordem.campo === "licencas"
                  ? contarDvrs(c.id)
                  : c.ativo;
        return comparar(val(a), val(b), ordem.asc);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes.data, servidores.data, dvrs.data, busca, filtroCliente, ordem]);

  const pag = usePaginacao(lista);

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes e limites de servidores e licenças de DVR."
        actions={
          isMaster && (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Novo cliente
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="sm:w-64">
            <ComboSelect
              value={filtroCliente}
              onChange={setFiltroCliente}
              options={[
                { value: "todos", label: "Todos os clientes" },
                ...(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
              ]}
              placeholder="Cliente"
              searchPlaceholder="Pesquisar cliente..."
            />
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar por nome, documento ou contato..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader campo="nome" ordem={ordem} setOrdem={setOrdem}>
                  Cliente
                </SortHeader>
                <SortHeader campo="contato" ordem={ordem} setOrdem={setOrdem}>
                  Contato
                </SortHeader>
                <SortHeader campo="servidores" ordem={ordem} setOrdem={setOrdem}>
                  Servidores
                </SortHeader>
                <SortHeader campo="licencas" ordem={ordem} setOrdem={setOrdem}>
                  Licenças DVR
                </SortHeader>
                <SortHeader campo="ativo" ordem={ordem} setOrdem={setOrdem}>
                  Status
                </SortHeader>
                <TableHead className="text-left">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.visiveis.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">{c.documento || "—"}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.contato_nome || "—"}
                    <br />
                    {c.contato_telefone || c.contato_email || ""}
                  </TableCell>
                  <TableCell>
                    {contarServidores(c.id)} / {c.max_servidores}
                  </TableCell>
                  <TableCell>
                    {contarDvrs(c.id)} / {c.max_licencas_dvr}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.ativo ? "default" : "secondary"}>
                      {c.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-start gap-1">
                      {isMaster && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setForm({
                              id: c.id,
                              nome: c.nome,
                              documento: c.documento ?? "",
                              contato_nome: c.contato_nome ?? "",
                              contato_email: c.contato_email ?? "",
                              contato_telefone: c.contato_telefone ?? "",
                              max_servidores: c.max_servidores,
                              max_licencas_dvr: c.max_licencas_dvr,
                              ativo: c.ativo,
                              restringir: Array.isArray(
                                (c as { permissoes_permitidas?: string[] | null })
                                  .permissoes_permitidas,
                              ),
                              permissoes:
                                (c as { permissoes_permitidas?: string[] | null })
                                  .permissoes_permitidas ?? [],
                              deteccoes: deteccoesDoForm(
                                (c as { deteccoes?: DeteccoesCliente }).deteccoes ?? null,
                              ),
                              sistemas: (c as { sistemas?: string[] | null }).sistemas ?? [],
                              carga_failover_ativo: !!(c as { carga_failover_ativo?: boolean }).carga_failover_ativo,
                              max_grupos_failover: (c as { max_grupos_failover?: number }).max_grupos_failover ?? 1,
                            });
                            setAberto(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isMaster && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`Excluir o cliente ${c.nome}?`)) excluir.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {pag.visiveis.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Nenhum cliente cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="clientes" />
        </CardContent>
      </Card>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="dados">
            <TabsList>
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="permissoes" data-ajuda="cliente-aba-permissoes">
                Permissões
              </TabsTrigger>
              <TabsTrigger value="deteccoes" data-ajuda="cliente-aba-deteccoes">
                Detecções
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="deteccoes"
              className="mt-4 space-y-3"
              data-ajuda="cliente-deteccoes"
            >
              <p className="text-xs text-muted-foreground">
                Marque os tipos de detecção liberados para este cliente e o limite de câmeras
                (vazio = sem limite).
              </p>
              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_120px_120px] gap-3 border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Tipo</span>
                  <span>Limite</span>
                  <span>Em uso</span>
                </div>
                {TIPOS_DETECCAO.map((t) => {
                  const r = form.deteccoes[t.value] ?? { liberado: false, limite: null };
                  const usadas = form.id ? (emUso.data?.[t.value] ?? 0) : 0;
                  const acima = r.limite != null && usadas > r.limite;
                  const set = (n: RegraDeteccao) =>
                    setForm({ ...form, deteccoes: { ...form.deteccoes, [t.value]: n } });
                  return (
                    <div
                      key={t.value}
                      className="grid grid-cols-[1fr_120px_120px] items-center gap-3 px-3 py-2"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={r.liberado}
                          onCheckedChange={(c) => set({ ...r, liberado: !!c })}
                        />
                        {t.label}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Sem limite"
                        disabled={!r.liberado}
                        value={r.limite ?? ""}
                        onChange={(e) =>
                          set({
                            ...r,
                            limite: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                      <span className={`text-sm ${acima ? "text-destructive" : ""}`}>
                        {usadas}
                        {r.limite != null ? ` / ${r.limite}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
            <TabsContent
              value="permissoes"
              className="mt-4 space-y-4"
              data-ajuda="cliente-permissoes"
            >
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.restringir}
                  onCheckedChange={(c) =>
                    setForm({
                      ...form,
                      restringir: !!c,
                      permissoes:
                        c && !form.permissoes.length
                          ? PERMISSOES.map((p) => p.value)
                          : form.permissoes,
                    })
                  }
                />
                Limitar as telas deste cliente
              </label>
              <p className="text-xs text-muted-foreground">
                {form.restringir
                  ? "Ao criar usuários deste cliente, só aparecem as telas marcadas abaixo."
                  : "Sem limite: os usuários deste cliente podem receber qualquer tela."}
              </p>
              {form.restringir && (
                <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                  {Array.from(new Set(PERMISSOES.map((p) => p.grupo))).map((g) => (
                    <div key={g} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <p className="w-36 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {g}
                      </p>
                      <div className="flex flex-1 flex-nowrap items-center gap-x-5 gap-y-2 overflow-x-auto">
                        {PERMISSOES.filter((p) => p.grupo === g).map((p) => (
                          <label
                            key={p.value}
                            className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm"
                          >
                            <Checkbox
                              checked={form.permissoes.includes(p.value)}
                              onCheckedChange={(c) =>
                                setForm({
                                  ...form,
                                  permissoes: c
                                    ? [...form.permissoes, p.value]
                                    : form.permissoes.filter((x) => x !== p.value),
                                })
                              }
                            />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="dados" className="mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Nome</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Sistema</Label>
                  <ComboMultiSelect
                    values={form.sistemas}
                    onChange={(v) => setForm({ ...form, sistemas: v })}
                    options={(sistemas.data ?? []).map((s) => ({ value: s.nome, label: s.nome }))}
                    placeholder="Selecione os sistemas que o cliente usa"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CNPJ / CPF</Label>
                  <Input
                    value={form.documento}
                    onChange={(e) => setForm({ ...form, documento: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contato</Label>
                  <Input
                    value={form.contato_nome}
                    onChange={(e) => setForm({ ...form, contato_nome: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    value={form.contato_email}
                    onChange={(e) => setForm({ ...form, contato_email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input
                    value={form.contato_telefone}
                    onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Servidores permitidos {!isMaster && <Lock className="h-3 w-3" />}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    disabled={!isMaster}
                    value={form.max_servidores}
                    onChange={(e) => setForm({ ...form, max_servidores: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    Licenças de DVR (total) {!isMaster && <Lock className="h-3 w-3" />}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    disabled={!isMaster}
                    value={form.max_licencas_dvr}
                    onChange={(e) => setForm({ ...form, max_licencas_dvr: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Carga e failover</Label>
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <Switch
                      checked={form.carga_failover_ativo}
                      onCheckedChange={(v) => setForm({ ...form, carga_failover_ativo: v })}
                    />
                    <span className="text-sm text-muted-foreground">
                      {form.carga_failover_ativo ? "Ativado" : "Desativado"}
                    </span>
                  </div>
                </div>
                {form.carga_failover_ativo && (
                  <div className="space-y-2">
                    <Label>Limite de grupos de failover</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.max_grupos_failover}
                      onChange={(e) => setForm({ ...form, max_grupos_failover: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate(form)} disabled={!form.nome || salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
