import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, servidoresQuery } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComboSelect } from "@/components/ComboSelect";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound, Search, Copy, RefreshCw, Radio } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SortHeader, comparar, type Ordem } from "@/components/SortHeader";
import { useMemo } from "react";
import { Paginacao, usePaginacao } from "@/components/Paginacao";

import { useServerFn } from "@tanstack/react-start";
import { verificarServidor } from "@/lib/agente.functions";


export const Route = createFileRoute("/_authenticated/servidores")({
  head: () => ({
    meta: [
      { title: "Servidores — Sentinela VIEW" },
      { name: "description", content: "Cadastro de servidores e vínculo de licença por cliente." },
      { property: "og:title", content: "Servidores — Sentinela VIEW" },
      { property: "og:description", content: "Cadastro de servidores e vínculo de licença." },
    ],
  }),
  component: ServidoresPage,
});

type Form = {
  id?: string;
  cliente_id: string;
  nome: string;
  descricao: string;
  licenca: string;
  ip: string;
  base_url: string;
  offline_apos_minutos: number;
  porta_udp_externa: string;
  ativo: boolean;
};

const vazio: Form = {
  cliente_id: "",
  nome: "",
  descricao: "",
  licenca: "",
  ip: "",
  base_url: "",
  offline_apos_minutos: 10,
  porta_udp_externa: "",
  ativo: true,
};


function ServidoresPage() {
  const { can } = useAuth();
  // Online só se o último sinal estiver dentro do limite "offline após" (padrão 10 min)
  const estaOnline = (s: { online: boolean | null; ultimo_contato: string | null; offline_apos_minutos?: number | null }) => {
    if (!s.online || !s.ultimo_contato) return false;
    const limite = Math.max(1, s.offline_apos_minutos || 10);
    return Date.now() - new Date(s.ultimo_contato).getTime() <= limite * 60000;
  };
  const qc = useQueryClient();
  const servidores = useQuery({
    ...servidoresQuery,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const clientes = useQuery(clientesQuery);
  const { clienteId: clienteGlobal, setClienteId: setClienteGlobal } = useClienteSelecionado();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [tokenAtual, setTokenAtual] = useState<{ id: string; token: string } | null>(null);


  const [licencas, setLicencas] = useState<
    { id: string; codigo: string; status: string; vinculada_em: string; revogada_em: string | null }[]
  >([]);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const filtroCliente = clienteGlobal || "todos";
  const setFiltroCliente = (v: string) => setClienteGlobal(v === "todos" ? "" : v);
  const [ordem, setOrdem] = useState<Ordem<"nome" | "ip" | "cliente" | "licenca" | "online" | "contato">>({
    campo: "nome",
    asc: true,
  });

  const lista = useMemo(() => {
    const termo = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const nomeCliente = (s: { clientes?: { nome: string } }) => s.clientes?.nome ?? "";
    return (servidores.data ?? [])
      .filter((s) => (filtroCliente === "todos" ? true : s.cliente_id === filtroCliente))
      .filter((s) =>
        termo
          ? [s.nome, s.ip, s.licenca, s.descricao, nomeCliente(s as never)]
              .filter(Boolean)
              .some((v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo))
          : true,
      )
      .sort((a, b) => {
        const val = (s: typeof a) =>
          ordem.campo === "nome"
            ? s.nome
            : ordem.campo === "ip"
              ? s.ip ?? ""
              : ordem.campo === "cliente"
                ? nomeCliente(s as never)
                : ordem.campo === "licenca"
                  ? s.licenca ?? ""
                  : ordem.campo === "online"
                    ? estaOnline(s)
                    : s.ultimo_contato ?? "";
        return comparar(val(a), val(b), ordem.asc);
      });
  }, [servidores.data, busca, filtroCliente, ordem]);


  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.id && f.cliente_id) {
        const cli = (clientes.data ?? []).find((c) => c.id === f.cliente_id) as
          | { nome: string; max_servidores: number }
          | undefined;
        const usados = (servidores.data ?? []).filter((x) => x.cliente_id === f.cliente_id).length;
        if (cli && usados >= cli.max_servidores) {
          throw new Error(
            `O cliente ${cli.nome} já usa ${usados} de ${cli.max_servidores} servidores permitidos.`,
          );
        }
      }
      const payload = {
        cliente_id: f.cliente_id,
        nome: f.nome,
        descricao: f.descricao || null,
        ip: f.ip || null,
        base_url: f.base_url || null,
        offline_apos_minutos: f.offline_apos_minutos,
        porta_udp_externa: f.porta_udp_externa ? Number(f.porta_udp_externa) : null,
        ativo: f.ativo,
      };

      const res = f.id
        ? await supabase.from("servidores").update(payload as never).eq("id", f.id)
        : await supabase.from("servidores").insert(payload as never);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success("Servidor salvo. A licença única é gerada pelo sistema.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["servidores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("servidores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servidor excluído");
      void qc.invalidateQueries({ queryKey: ["servidores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verHistorico = async (servidorId: string) => {
    const { data } = await supabase
      .from("licencas")
      .select("id, codigo, status, vinculada_em, revogada_em")
      .eq("servidor_id", servidorId)
      .order("vinculada_em", { ascending: false });
    setLicencas(data ?? []);
    setHistoricoAberto(true);
  };

  const copiar = async (texto: string, rotulo: string) => {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} copiado`);
  };

  const novaChave = useMutation({
    mutationFn: async (servidorId: string) => {
      const { data, error } = await supabase.rpc("regenerar_token_servidor", {
        _servidor_id: servidorId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Nova chave gerada. Atualize a chave no servidor.");
      void qc.invalidateQueries({ queryKey: ["servidores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const novaLicenca = useMutation({
    mutationFn: async (servidorId: string) => {
      const { data, error } = await supabase.rpc("regenerar_licenca_servidor", {
        _servidor_id: servidorId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Nova licença gerada. A anterior foi derrubada.");
      void qc.invalidateQueries({ queryKey: ["servidores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pag = usePaginacao(lista);

  const chamarVerificacao = useServerFn(verificarServidor);
  const testar = useMutation({
    mutationFn: async (servidorId: string) => chamarVerificacao({ data: { servidorId } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Servidor respondeu. Status atualizado para Online.");
      else toast.error(`Servidor não respondeu. ${r.detalhe}`);
      void qc.invalidateQueries({ queryKey: ["servidores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  return (
    <div>
      <PageHeader
        title="Servidores"
        description="Vincule a licença gerada pelo servidor para que ele saiba quais DVRs deve subir."
        actions={
          can("servidores.criar") && (
            <Button
              onClick={() => {
                setForm({
                  ...vazio,
                  cliente_id: clienteGlobal || (clientes.data?.length === 1 ? clientes.data[0]!.id : ""),
                });
                setTokenAtual(null);
                setAberto(true);

              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Novo servidor
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
              placeholder="Pesquisar por servidor, IP ou licença..."
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
                <SortHeader campo="nome" ordem={ordem} setOrdem={setOrdem} className="pl-4">Servidor</SortHeader>
                <SortHeader campo="ip" ordem={ordem} setOrdem={setOrdem}>IP</SortHeader>
                <SortHeader campo="cliente" ordem={ordem} setOrdem={setOrdem}>Cliente</SortHeader>
                <SortHeader campo="licenca" ordem={ordem} setOrdem={setOrdem}>Licença</SortHeader>
                <SortHeader campo="online" ordem={ordem} setOrdem={setOrdem}>Status</SortHeader>
                <SortHeader campo="contato" ordem={ordem} setOrdem={setOrdem}>Último contato</SortHeader>
                <TableHead className="text-left pr-4">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.visiveis.map((s) => {
                const metricas = (s as { metricas_agent?: Record<string, unknown> | null }).metricas_agent;
                const num = (c: string) =>
                  metricas && typeof metricas[c] === "number" ? (metricas[c] as number) : null;
                const detalhes = [
                  s.versao ? `versão ${s.versao}` : null,
                  num("cpu_percent") !== null ? `CPU ${Math.round(num("cpu_percent")!)}%` : null,
                  num("memory_mb") !== null ? `${Math.round(num("memory_mb")!)} MB` : null,
                  num("active_viewers") !== null ? `${num("active_viewers")} assistindo` : null,
                  num("hot_streams") !== null ? `${num("hot_streams")} ativas` : null,
                ].filter(Boolean) as string[];
                return (
                <TableRow key={s.id} className="align-top">
                  <TableCell className="py-3 pl-4 pr-2">
                    <p className="font-medium leading-5">{s.nome}</p>
                    {s.descricao && (
                      <p className="mt-0.5 max-w-[24rem] truncate text-xs text-muted-foreground">{s.descricao}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {s.ip || <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex max-w-[13rem] items-center truncate rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      <span className="truncate">{(s as { clientes?: { nome: string } }).clientes?.nome ?? "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.licenca ? (
                      <span className="font-mono text-[11px] leading-4 text-muted-foreground">{s.licenca}</span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/60">não vinculada</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[9rem]">
                    <div className="flex items-center gap-2">
                      <Badge variant={estaOnline(s) ? "default" : "secondary"}>
                        {estaOnline(s) ? "Online" : "Offline"}
                      </Badge>
                    </div>
                    {detalhes.length > 0 && (
                      <p className="mt-1 max-w-[14rem] truncate text-[11px] leading-4 text-muted-foreground">
                        {detalhes.join(" · ")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {s.ultimo_contato ? new Date(s.ultimo_contato).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-start gap-0.5">
                    {can("servidores.editar") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Testar conexão com o servidor"
                        disabled={testar.isPending}
                        onClick={() => testar.mutate(s.id)}
                      >
                        <Radio className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title="Histórico de licenças" onClick={() => verHistorico(s.id)}>
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    {can("servidores.editar") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setForm({
                            id: s.id,
                            cliente_id: s.cliente_id,
                            nome: s.nome,
                            descricao: s.descricao ?? "",
                            licenca: s.licenca ?? "",
                            ip: s.ip ?? "",
                            base_url: s.base_url ?? "",
                            offline_apos_minutos: s.offline_apos_minutos ?? 10,
                            porta_udp_externa: String((s as { porta_udp_externa?: number | null }).porta_udp_externa ?? ""),
                            ativo: s.ativo,
                          });
                          setTokenAtual({ id: s.id, token: s.token ?? "" });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}

                    {can("servidores.excluir") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Excluir o servidor ${s.nome}?`)) excluir.mutate(s.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
              {pag.visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum servidor cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="servidores" />
        </CardContent>
      </Card>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar servidor" : "Novo servidor"}</DialogTitle>
            <DialogDescription>
              Ao trocar a licença, a anterior é derrubada automaticamente e fica no histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Cliente</Label>
              <ComboSelect
                value={form.cliente_id}
                onChange={(v) => setForm({ ...form, cliente_id: v })}
                options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione o cliente"
                searchPlaceholder="Pesquisar cliente..."
              />

            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>IP</Label>
              <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Licença (gerada automaticamente)</Label>
              {form.id ? (
                <div className="flex items-center gap-2">
                  <Input readOnly className="font-mono" value={form.licenca} />
                  <Button
                    variant="outline"
                    size="icon"
                    title="Copiar licença"
                    onClick={() => void copiar(form.licenca, "Licença")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Gerar nova licença"
                    disabled={novaLicenca.isPending}
                    onClick={() => {
                      if (!confirm("Gerar nova licença? A anterior é derrubada na hora.")) return;
                      novaLicenca.mutate(form.id!, {
                        onSuccess: (l) => setForm((f) => ({ ...f, licenca: l })),
                      });
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A licença única será criada automaticamente ao salvar o servidor.
                </p>
              )}
            </div>
            {form.id && tokenAtual?.id === form.id && (
              <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
                <Label>Chave secreta deste servidor</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly className="font-mono text-xs" value={tokenAtual.token} />
                  <Button
                    variant="outline"
                    size="icon"
                    title="Copiar chave"
                    onClick={() => void copiar(tokenAtual.token, "Chave")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Gerar nova chave"
                    disabled={novaChave.isPending}
                    onClick={() => {
                      if (!confirm("Gerar nova chave? O servidor para de comunicar até ser atualizado.")) return;
                      novaChave.mutate(form.id!, {
                        onSuccess: (t) => setTokenAtual({ id: form.id!, token: t }),
                      });
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Envie no seu servidor esta licença e chave (cabeçalho x-agente-token). Ele fica
                  Online a cada sinal recebido.
                </p>
              </div>
            )}


            <div className="space-y-2">
              <Label>Considerar offline após (minutos)</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={form.offline_apos_minutos}
                onChange={(e) =>
                  setForm({ ...form, offline_apos_minutos: Number(e.target.value) || 10 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Porta UDP externa do vídeo (opcional)</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                placeholder="45000"
                value={form.porta_udp_externa}
                onChange={(e) => setForm({ ...form, porta_udp_externa: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Porta liberada no roteador para acesso externo. A porta interna do servidor continua 45000.
                Use uma diferente para cada servidor no mesmo local (ex.: 45001 → 45000 do servidor 2).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate(form)}
              disabled={!form.nome || !form.cliente_id || salvar.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Histórico de licenças</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {licencas.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma licença registrada.</p>
            )}
            {licencas.map((l) => (
              <div key={l.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{l.codigo}</span>
                  <Badge variant={l.status === "ativa" ? "default" : "secondary"}>
                    {l.status === "ativa" ? "Ativa" : "Revogada"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vinculada em {new Date(l.vinculada_em).toLocaleString("pt-BR")}
                  {l.revogada_em && ` · revogada em ${new Date(l.revogada_em).toLocaleString("pt-BR")}`}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
