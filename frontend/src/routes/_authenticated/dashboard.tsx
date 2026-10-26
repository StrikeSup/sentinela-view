import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { clientesQuery, dvrsQuery, eventosQuery, servidoresQuery } from "@/lib/queries";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { ComboSelect } from "@/components/ComboSelect";
import { Users, Server, HardDrive, WifiOff, ArrowDownRight, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Painel — Sentinela VIEW" },
      { name: "description", content: "Visão geral de servidores, clientes, DVRs e quedas." },
      { property: "og:title", content: "Painel — Sentinela VIEW" },
      { property: "og:description", content: "Visão geral de servidores, clientes, DVRs e quedas." },
    ],
  }),
  component: Dashboard,
});

function Stat({
  titulo,
  valor,
  detalhe,
  icon: Icon,
}: {
  titulo: string;
  valor: string | number;
  detalhe?: string;
  icon: typeof Users;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="font-display text-2xl font-bold">{valor}</p>
          {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const clientes = useQuery(clientesQuery);
  const servidores = useQuery(servidoresQuery);
  const dvrs = useQuery(dvrsQuery);
  const eventos = useQuery(eventosQuery);
  const { clienteId, setClienteId, clientes: clientesDoContexto, bloqueado } = useClienteSelecionado();

  const opcoesCliente = [
    { value: "", label: "Todos os clientes" },
    ...clientesDoContexto.map((c) => ({ value: c.id, label: c.nome })),
  ];

  const clientesVisiveis = clienteId
    ? (clientes.data ?? []).filter((cliente) => cliente.id === clienteId)
    : (clientes.data ?? []);
  const servidoresVisiveis = clienteId
    ? (servidores.data ?? []).filter((servidor) => servidor.cliente_id === clienteId)
    : (servidores.data ?? []);
  const dvrsVisiveis = clienteId
    ? (dvrs.data ?? []).filter((dvr) => dvr.cliente_id === clienteId)
    : (dvrs.data ?? []);
  const eventosVisiveis = clienteId
    ? (eventos.data ?? []).filter((evento) => evento.cliente_id === clienteId)
    : (eventos.data ?? []);

  const dvrsOffline = dvrsVisiveis.filter((d) => !d.online).length;
  const servidoresOnline = servidoresVisiveis.filter((s) => s.online).length;

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Visão geral do monitoramento em tempo real."
        actions={
          <div className="w-56">
            <ComboSelect
              value={clienteId}
              onChange={setClienteId}
              options={opcoesCliente}
              disabled={bloqueado}
              placeholder="Cliente"
              searchPlaceholder="Pesquisar cliente..."
              emptyText="Nenhum cliente encontrado."
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat titulo="Clientes" valor={clientesVisiveis.length} icon={Users} />
        <Stat
          titulo="Servidores"
          valor={servidoresVisiveis.length}
          detalhe={`${servidoresOnline} online`}
          icon={Server}
        />
        <Stat titulo="DVRs" valor={dvrsVisiveis.length} icon={HardDrive} />
        <Stat titulo="DVRs offline" valor={dvrsOffline} icon={WifiOff} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Servidores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {servidoresVisiveis.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum servidor cadastrado.</p>
            )}
            {servidoresVisiveis.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {(s as { clientes?: { nome: string } }).clientes?.nome ?? "—"}
                  </p>
                </div>
                <Badge variant={s.online ? "default" : "secondary"}>
                  {s.online ? "Online" : "Offline"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos eventos de desconexão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {eventosVisiveis.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
            )}
            {eventosVisiveis.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {e.tipo === "queda" ? (
                    <ArrowDownRight className="h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {e.dvr_id
                        ? ((e as { dvrs?: { nome: string } }).dvrs?.nome ?? "DVR")
                        : `Servidor ${(e as { servidores?: { nome: string } }).servidores?.nome ?? ""}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(e as { clientes?: { nome: string } }).clientes?.nome ?? "—"}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.ocorrido_em).toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
