import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery, servidoresQuery } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ComboSelect } from "@/components/ComboSelect";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Download } from "lucide-react";
import { Paginacao, usePaginacao } from "@/components/Paginacao";


export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Sentinela VIEW" },
      { name: "description", content: "Relatórios de quedas e retornos de DVRs por cliente e período." },
      { property: "og:title", content: "Relatórios — Sentinela VIEW" },
      { property: "og:description", content: "Relatórios de quedas e retornos por período." },
    ],
  }),
  component: RelatoriosPage,
});

type Linha = {
  tipo: "conexao" | "hd";
  detalhe?: string | null;
  dvr: string;
  cliente: string;
  caiu: string;
  voltou: string | null;
  duracao: string;
};

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function duracaoTexto(segundos: number) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return `${h}h ${m}min`;
}

function RelatoriosPage() {
  const clientes = useQuery(clientesQuery);
  const dvrs = useQuery(dvrsQuery);
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - 7);

  const { clienteId: clienteGlobal, setClienteId: setClienteGlobal, bloqueado: clienteFixo } =
    useClienteSelecionado();
  const clienteId = clienteGlobal || "todos";
  const setClienteId = (v: string) => setClienteGlobal(v === "todos" ? "" : v);
  const [dvrId, setDvrId] = useState("todos");
  const servidores = useQuery(servidoresQuery);
  const [servidorIds, setServidorIds] = useState<string[] | null>(null);
  const servidoresDoCliente = (servidores.data ?? []).filter(
    (s) => clienteId === "todos" || s.cliente_id === clienteId,
  );
  const servSel = servidorIds ?? servidoresDoCliente.map((s) => s.id);
  const [de, setDe] = useState(toLocalInput(inicio));
  const [ate, setAte] = useState(toLocalInput(new Date()));
  const [filtro, setFiltro] = useState<{
    clienteId: string;
    dvrId: string;
    de: string;
    ate: string;
    servidores: string[] | null;
  }>({ clienteId, dvrId: "todos", de, ate, servidores: null });

  useEffect(() => {
    setFiltro((f) => ({ ...f, clienteId, dvrId: "todos", servidores: null }));
    setDvrId("todos");
    setServidorIds(null);
  }, [clienteId]);

  const relatorio = useQuery({
    queryKey: ["relatorio", filtro],
    queryFn: async (): Promise<Linha[]> => {
      let q = supabase
        .from("eventos_conexao")
        .select("*, dvrs(nome, servidor_id), clientes(nome), servidores(nome)")
        .gte("ocorrido_em", new Date(filtro.de).toISOString())
        .lte("ocorrido_em", new Date(filtro.ate).toISOString())
        .order("ocorrido_em", { ascending: true })
        .limit(1000);
      if (filtro.clienteId !== "todos") q = q.eq("cliente_id", filtro.clienteId);
      if (filtro.dvrId !== "todos") q = q.eq("dvr_id", filtro.dvrId);
      const { data, error } = await q;
      if (error) throw error;

      const permitidos = filtro.servidores ? new Set(filtro.servidores) : null;
      const abertos = new Map<string, { caiu: string; dvr: string; cliente: string }>();
      const linhas: Linha[] = [];
      for (const e of data ?? []) {
        const ev = e as typeof e & {
          dvrs?: { nome: string; servidor_id: string | null } | null;
          servidores?: { nome: string } | null;
        };
        const srv = e.servidor_id ?? ev.dvrs?.servidor_id ?? null;
        if (permitidos && (!srv || !permitidos.has(srv))) continue;
        const nomeDvr = e.dvr_id
          ? (ev.dvrs?.nome ?? "DVR")
          : `Servidor ${ev.servidores?.nome ?? ""}`.trim();
        const nomeCliente = (e as { clientes?: { nome: string } }).clientes?.nome ?? "—";
        const chave = e.dvr_id ?? `srv:${e.servidor_id ?? nomeDvr}`;
        if (e.tipo === "queda") {
          abertos.set(chave, { caiu: e.ocorrido_em, dvr: nomeDvr, cliente: nomeCliente });
        } else {
          const q0 = abertos.get(chave);
          const caiu = q0?.caiu ?? e.ocorrido_em;
          const segundos = Math.max(
            0,
            Math.round((new Date(e.ocorrido_em).getTime() - new Date(caiu).getTime()) / 1000),
          );
          linhas.push({
            tipo: "conexao",
            dvr: nomeDvr,
            cliente: nomeCliente,
            caiu,
            voltou: e.ocorrido_em,
            duracao: duracaoTexto(segundos),
          });
          abertos.delete(chave);
        }
      }
      for (const [, v] of abertos) {
        linhas.push({ tipo: "conexao", dvr: v.dvr, cliente: v.cliente, caiu: v.caiu, voltou: null, duracao: "em aberto" });
      }

      // HD: problema -> normalizou (independente de o DVR estar conectado)
      let qh = supabase
        .from("eventos_hd" as never)
        .select("*, dvrs(nome, servidor_id), clientes:cliente_id(nome)")
        .gte("ocorrido_em", new Date(filtro.de).toISOString())
        .lte("ocorrido_em", new Date(filtro.ate).toISOString())
        .order("ocorrido_em", { ascending: true })
        .limit(1000);
      if (filtro.clienteId !== "todos") qh = qh.eq("cliente_id", filtro.clienteId);
      if (filtro.dvrId !== "todos") qh = qh.eq("dvr_id", filtro.dvrId);
      const { data: hd } = await qh;
      const abertosHd = new Map<string, { caiu: string; dvr: string; cliente: string; detalhe: string | null }>();
      type EvHd = {
        dvr_id: string; servidor_id: string | null; tipo: string; status_hd: string | null; ocorrido_em: string;
        dvrs?: { nome: string; servidor_id: string | null } | null; clientes?: { nome: string } | null;
      };
      for (const e of (hd ?? []) as unknown as EvHd[]) {
        const srv = e.servidor_id ?? e.dvrs?.servidor_id ?? null;
        if (permitidos && (!srv || !permitidos.has(srv))) continue;
        const dvr = e.dvrs?.nome ?? "DVR";
        const cliente = e.clientes?.nome ?? "—";
        if (e.tipo === "problema") {
          if (!abertosHd.has(e.dvr_id))
            abertosHd.set(e.dvr_id, { caiu: e.ocorrido_em, dvr, cliente, detalhe: e.status_hd });
        } else {
          const a = abertosHd.get(e.dvr_id);
          if (!a) continue;
          const seg = Math.max(0, Math.round((new Date(e.ocorrido_em).getTime() - new Date(a.caiu).getTime()) / 1000));
          linhas.push({ tipo: "hd", detalhe: a.detalhe, dvr, cliente, caiu: a.caiu, voltou: e.ocorrido_em, duracao: duracaoTexto(seg) });
          abertosHd.delete(e.dvr_id);
        }
      }
      for (const [, a] of abertosHd)
        linhas.push({ tipo: "hd", detalhe: a.detalhe, dvr: a.dvr, cliente: a.cliente, caiu: a.caiu, voltou: null, duracao: "em aberto" });
      return linhas.sort((a, b) => (a.caiu < b.caiu ? 1 : -1));
    },
  });

  const exportarCsv = () => {
    const linhas = relatorio.data ?? [];
    const csv = [
      "DVR;Cliente;Evento;Detalhe;Início;Fim;Duração",
      ...linhas.map(
        (l) =>
          `${l.dvr};${l.cliente};${l.tipo === "hd" ? "HD com problema" : "DVR desconectado"};${l.detalhe ?? ""};${new Date(l.caiu).toLocaleString("pt-BR")};${
            l.voltou ? new Date(l.voltou).toLocaleString("pt-BR") : "—"
          };${l.duracao}`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio-quedas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const pag = usePaginacao(relatorio.data ?? []);

  const dvrsFiltrados = (dvrs.data ?? []).filter(
    (d) => clienteId === "todos" || d.cliente_id === clienteId,
  );

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Desconexões de DVRs e problemas de HD por cliente e período."
        actions={
          <Button variant="outline" onClick={exportarCsv} disabled={!(relatorio.data ?? []).length}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid gap-4 p-5 md:grid-cols-6">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ComboSelect
              value={clienteId}
              disabled={clienteFixo}
              onChange={(v) => {
                setClienteId(v);
                setDvrId("todos");
              }}
              options={[
                { value: "todos", label: "Todos" },
                ...(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
              ]}
              searchPlaceholder="Pesquisar cliente..."
            />
          </div>
          <div className="space-y-2">
            <Label>Servidor</Label>
            <ComboMultiSelect
              values={servSel}
              onChange={setServidorIds}
              options={servidoresDoCliente.map((s) => ({ value: s.id, label: s.nome }))}
              placeholder="Nenhum servidor"
              searchPlaceholder="Pesquisar servidor..."
              allLabel="Todos"
            />
          </div>
          <div className="space-y-2">
            <Label>DVR</Label>
            <ComboSelect
              value={dvrId}
              onChange={setDvrId}
              options={[
                { value: "todos", label: "Todos" },
                ...dvrsFiltrados.map((d) => ({ value: d.id, label: d.nome })),
              ]}
              searchPlaceholder="Pesquisar DVR..."
            />

          </div>
          <div className="space-y-2">
            <Label>De</Label>
            <Input type="datetime-local" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input type="datetime-local" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={() =>
                setFiltro({
                  clienteId,
                  dvrId,
                  de,
                  ate,
                  servidores:
                    servidorIds === null || servSel.length === servidoresDoCliente.length
                      ? null
                      : servSel,
                })
              }
            >
              <Search className="mr-2 h-4 w-4" /> Gerar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DVR</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Normalizou em</TableHead>
                <TableHead>Duração</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.visiveis.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{l.dvr}</TableCell>
                  <TableCell>{l.cliente}</TableCell>
                  <TableCell>
                    {l.tipo === "hd" ? (
                      <span title={l.detalhe ?? undefined}>
                        <Badge variant="destructive">HD com problema</Badge>
                      </span>
                    ) : (
                      <Badge variant="secondary">DVR desconectado</Badge>
                    )}
                  </TableCell>
                  <TableCell>{new Date(l.caiu).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>
                    {l.voltou ? (
                      new Date(l.voltou).toLocaleString("pt-BR")
                    ) : (
                      <Badge variant="destructive">{l.tipo === "hd" ? "Ainda com problema" : "Ainda fora"}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{l.duracao}</TableCell>
                </TableRow>
              ))}
              {pag.visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum evento no período selecionado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="eventos" />
        </CardContent>
      </Card>
    </div>
  );
}
