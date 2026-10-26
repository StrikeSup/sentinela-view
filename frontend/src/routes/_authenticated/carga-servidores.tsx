import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ComboSelect } from "@/components/ComboSelect";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Info, Scale, Search, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
const normalizarBusca = (s: string) => s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const Route = createFileRoute("/_authenticated/carga-servidores")({
  head: () => ({
    meta: [
      { title: "Carga dos servidores — Sentinela VIEW" },
      { name: "description", content: "Divisão de câmeras entre servidores e failover automático por grupo." },
      { property: "og:title", content: "Carga dos servidores — Sentinela VIEW" },
      { property: "og:description", content: "Divisão de câmeras entre servidores e failover por grupo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CargaServidoresPage,
});

type Servidor = {
  id: string; nome: string; online: boolean; ativo: boolean; cliente_id: string;
  grupo_failover: string | null; retorno_estavel_minutos: number; peso_carga: number | null; clientes?: { nome: string } | null;
};
type Dvr = {
  id: string; nome: string; canais: number; ativo: boolean; cliente_id: string;
  servidor_id: string | null; servidor_principal_id: string | null; servidor_fixo: boolean;
  em_failover_desde: string | null; clientes?: { nome: string } | null;
};

const db = supabase as any;

function CargaServidoresPage() {
  const { can } = useAuth();
  const podeEditar = can("servidores.editar");
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const servidores = useQuery({
    queryKey: ["carga", "servidores"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await db.from("servidores")
        .select("id,nome,online,ativo,cliente_id,grupo_failover,retorno_estavel_minutos,peso_carga,clientes(nome,carga_failover_ativo)").order("nome");
      if (error) throw error;
      // Só clientes com Carga e failover ativado aparecem aqui
      return (data as (Servidor & { clientes?: { carga_failover_ativo?: boolean } | null })[]).filter((s) => s.clientes?.carga_failover_ativo) as Servidor[];
    },
  });
  const dvrs = useQuery({
    queryKey: ["carga", "dvrs"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await db.from("dvrs")
        .select("id,nome,canais,ativo,cliente_id,servidor_id,servidor_principal_id,servidor_fixo,em_failover_desde,clientes(nome,carga_failover_ativo)").order("nome");
      if (error) throw error;
      return (data as (Dvr & { clientes?: { carga_failover_ativo?: boolean } | null })[]).filter((d) => d.clientes?.carga_failover_ativo) as Dvr[];
    },
  });

  // Enquanto a tela está aberta: marca servidores sem sinal como offline e roda failover/retorno
  useEffect(() => {
    const rodar = async () => {
      await db.rpc("marcar_offline_expirados");
      qc.invalidateQueries({ queryKey: ["carga"] });
    };
    rodar();
    const t = setInterval(rodar, 30_000);
    return () => clearInterval(t);
  }, [qc]);
  const [filtroCliente, setFiltroCliente] = useState("");

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["carga"] });
    qc.invalidateQueries({ queryKey: ["dvrs"] });
    qc.invalidateQueries({ queryKey: ["servidores"] });
  };

  const salvarServidor = useMutation({
    mutationFn: async (p: { id: string; campos: Partial<Servidor> }) => {
      const { error } = await db.from("servidores").update(p.campos).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });
  const salvarDvr = useMutation({
    mutationFn: async (p: { id: string; campos: Partial<Dvr> }) => {
      const { error } = await db.from("dvrs").update(p.campos).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });
  const redistribuir = useMutation({
    mutationFn: async (grupo: string) => {
      const { data, error } = await db.rpc("redistribuir_carga_grupo", { _grupo: grupo });
      if (error) throw error;
      await db.rpc("balancear_carga_servidores");
      return data as number;
    },
    onSuccess: (n) => { toast.success(n ? `${n} DVR(s) redistribuído(s)` : "Carga já está equilibrada"); recarregar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = servidores.data ?? [];
  const listaDvrs = dvrs.data ?? [];
  const nomeServ = useMemo(() => new Map(lista.map((s) => [s.id, s.nome])), [lista]);

  const carga = useMemo(() => {
    const m = new Map<string, { cameras: number; dvrs: number }>();
    for (const d of listaDvrs) {
      if (!d.servidor_id || !d.ativo) continue;
      const c = m.get(d.servidor_id) ?? { cameras: 0, dvrs: 0 };
      c.cameras += d.canais || 0; c.dvrs += 1;
      m.set(d.servidor_id, c);
    }
    return m;
  }, [listaDvrs]);

  const gruposDe = (servs: Servidor[]) => {
    const g = new Map<string, Servidor[]>();
    for (const s of servs) {
      const k = s.grupo_failover?.trim() || "";
      g.set(k, [...(g.get(k) ?? []), s]);
    }
    return [...g.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  };

  // Separa tudo por cliente: servidores e DVRs de cada cliente ficam na sua seção
  const porCliente = useMemo(() => {
    const m = new Map<string, { nome: string; servidores: Servidor[]; dvrs: Dvr[] }>();
    const garantir = (id: string | null, nome?: string | null) => {
      const k = id ?? "_sem";
      if (!m.has(k)) m.set(k, { nome: nome ?? "Sem cliente", servidores: [], dvrs: [] });
      else if (nome && m.get(k)!.nome === "Sem cliente") m.get(k)!.nome = nome;
      return m.get(k)!;
    };
    for (const s of lista) garantir(s.cliente_id, s.clientes?.nome).servidores.push(s);
    for (const d of listaDvrs) garantir(d.cliente_id, d.clientes?.nome).dvrs.push(d);
    return [...m.entries()].sort(([, a], [, b]) => a.nome.localeCompare(b.nome));
  }, [lista, listaDvrs]);

  const dvrsFiltradosDe = (dvrsCliente: Dvr[]) => {
    const q = normalizarBusca(busca);
    return dvrsCliente.filter((d) => !q || normalizarBusca(`${d.nome} ${d.clientes?.nome ?? ""} ${nomeServ.get(d.servidor_id ?? "") ?? ""}`).includes(q));
  };

  const emFailover = listaDvrs.filter((d) => d.servidor_id && d.servidor_principal_id && d.servidor_id !== d.servidor_principal_id).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carga dos servidores"
        description="Divide as câmeras entre os servidores. Servidores do mesmo grupo assumem os DVRs uns dos outros quando um cai, e o DVR volta para o servidor principal depois que ele ficar estável."
      />

      {emFailover > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          {emFailover} DVR(s) estão rodando fora do servidor principal (failover ativo).
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar DVR, cliente ou servidor" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <ComboSelect
          className="w-64"
          value={filtroCliente}
          onChange={setFiltroCliente}
          placeholder="Todos os clientes"
          options={[{ value: "", label: "Todos os clientes" }, ...porCliente.map(([id, s]) => ({ value: id, label: s.nome }))]}
        />
      </div>

      {porCliente.filter(([id]) => !filtroCliente || id === filtroCliente).map(([clienteId, secao]) => (
        <div key={clienteId} className="space-y-4">
          <h2 className="text-lg font-semibold">{secao.nome}</h2>

          {gruposDe(secao.servidores).map(([grupo, servs]) => {
        const total = servs.reduce((a, s) => a + (carga.get(s.id)?.cameras ?? 0), 0);
        return (
          <Card key={grupo || "_sem"}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {grupo ? `Grupo ${grupo}` : "Sem grupo (sem failover)"}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{total} câmeras</span>
              </CardTitle>
              {grupo && podeEditar && (
                <Button size="sm" variant="outline" disabled={redistribuir.isPending} onClick={() => redistribuir.mutate(grupo)}>
                  <Scale className="mr-2 h-4 w-4" /> Dividir carga
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {servs.map((s) => {
                const c = carga.get(s.id) ?? { cameras: 0, dvrs: 0 };
                const pct = total ? Math.round((c.cameras / total) * 100) : 0;
                return (
                  <div key={s.id} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{s.nome}</div>
                        <div className="text-xs text-muted-foreground">{s.clientes?.nome}</div>
                      </div>
                      <Badge variant={s.online ? "default" : "destructive"}>{s.online ? "online" : "offline"}</Badge>
                    </div>
                    <div className="text-sm">{c.cameras} câmeras · {c.dvrs} DVRs · {pct}%</div>
                    <Progress value={pct} />
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs text-muted-foreground">
                        Grupo de failover
                        <Input
                          key={`g-${s.id}-${s.grupo_failover}`}
                          defaultValue={s.grupo_failover ?? ""}
                          placeholder="ex.: A"
                          disabled={!podeEditar}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== (s.grupo_failover ?? null)) salvarServidor.mutate({ id: s.id, campos: { grupo_failover: v } });
                          }}
                        />
                      </label>
                      {s.grupo_failover ? (
                      <label className="space-y-1 text-xs text-muted-foreground">
                        Voltar após (min)
                        <Input
                          key={`r-${s.id}-${s.retorno_estavel_minutos}`}
                          type="number" min={0} max={1440}
                          defaultValue={s.retorno_estavel_minutos}
                          disabled={!podeEditar}
                          onBlur={(e) => {
                            const v = Math.max(0, Math.min(1440, Number(e.target.value) || 0));
                            if (v !== s.retorno_estavel_minutos) salvarServidor.mutate({ id: s.id, campos: { retorno_estavel_minutos: v } });
                          }}
                        />
                      </label>
                      ) : (
                        <div className="self-end pb-2 text-xs text-muted-foreground">Sem failover: defina um grupo para usar "Voltar após".</div>
                      )}
                      {s.grupo_failover && (
                      <label className="col-span-2 space-y-1 text-xs text-muted-foreground">
                        Porcentagem da carga (%) — vazio = divisão igual
                        <Input
                          key={`p-${s.id}-${s.peso_carga}`}
                          type="number" min={0} max={100}
                          defaultValue={s.peso_carga ?? ""}
                          placeholder="automático"
                          disabled={!podeEditar}
                          onBlur={(e) => {
                            const t = e.target.value.trim();
                            const v = t === "" ? null : Math.max(0, Math.min(100, Math.round(Number(t) || 0)));
                            if (v !== (s.peso_carga ?? null)) salvarServidor.mutate({ id: s.id, campos: { peso_carga: v } });
                          }}
                        />
                      </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">DVRs por servidor</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DVR</TableHead>
                    <TableHead>Câmeras</TableHead>
                    <TableHead>Servidor principal</TableHead>
                    <TableHead>Rodando em</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Fixar no principal
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" aria-label="O que é fixar no principal" className="text-muted-foreground hover:text-foreground">
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Impede que o botão 'Dividir carga' mude o servidor principal deste DVR. Se o servidor cair, o failover temporário continua funcionando normalmente.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dvrsFiltradosDe(secao.dvrs).map((d) => {
                const opcoes = lista.filter((s) => s.cliente_id === d.cliente_id || s.grupo_failover)
                  .map((s) => ({ value: s.id, label: s.nome, hint: s.grupo_failover ? `grupo ${s.grupo_failover}` : "" }));
                const failover = d.servidor_id && d.servidor_principal_id && d.servidor_id !== d.servidor_principal_id;
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium">{d.nome}</div>
                      <div className="text-xs text-muted-foreground">{d.clientes?.nome}</div>
                    </TableCell>
                    <TableCell>{d.canais}</TableCell>
                    <TableCell className="w-56">
                      <ComboSelect
                        value={d.servidor_principal_id ?? ""}
                        options={opcoes}
                        disabled={!podeEditar}
                        placeholder="Automático"
                        onChange={(v) => salvarDvr.mutate({ id: d.id, campos: { servidor_principal_id: v, servidor_fixo: true } })}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {nomeServ.get(d.servidor_id ?? "") ?? "—"}
                      {failover && <Badge variant="destructive" className="ml-2">failover</Badge>}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={d.servidor_fixo}
                        disabled={!podeEditar}
                        onCheckedChange={(v) => salvarDvr.mutate({ id: d.id, campos: { servidor_fixo: v } })}
                      />
                    </TableCell>
                  </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        DVRs fixados não são movidos ao clicar em "Dividir carga", mas continuam tendo failover se o servidor cair. DVRs novos vão automaticamente para o servidor do cliente com menos câmeras.
      </p>
    </div>
  );
}
