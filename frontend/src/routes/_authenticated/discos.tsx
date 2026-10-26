import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { servidoresQuery } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboSelect } from "@/components/ComboSelect";
import { DiscosGravacoes } from "@/components/DiscosGravacoes";

export const Route = createFileRoute("/_authenticated/discos")({
  head: () => ({
    meta: [
      { title: "Discos dos servidores — Sentinela VIEW" },
      {
        name: "description",
        content:
          "Espaço total, usado e livre de cada HD dos servidores e escolha de onde as gravações são guardadas.",
      },
      { property: "og:title", content: "Discos dos servidores — Sentinela VIEW" },
      {
        property: "og:description",
        content: "Acompanhe o espaço dos HDs e escolha onde gravar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiscosPage,
});

type Disco = {
  id: string;
  rotulo?: string | null;
  ponto_montagem?: string | null;
  sistema_arquivos?: string | null;
  total_bytes?: number | null;
  usado_bytes?: number | null;
  livre_bytes?: number | null;
  gravando?: boolean | null;
  somente_leitura?: boolean | null;
  removivel?: boolean | null;
  saudavel?: boolean | null;
  diagnostico?: string | null;
  /** DVRs já vinculados a este volume pelo servidor local. */
  dvrs?: unknown;
};

type Sincronizacao = {
  em?: string | null;
  discos?: number | null;
  arquivos_recebidos?: number | null;
  gravacao?: boolean | null;
};

/** Medição mais velha que isso é apresentada como desatualizada. */
const OBSOLETO_MIN = 10;

type ServidorComDiscos = {
  id: string;
  nome: string;
  cliente_id: string | null;
  online: boolean | null;
  discos?: unknown;
  discos_em?: string | null;
  discos_gravacao?: unknown;
  gravar_todos_discos?: boolean | null;
  sincronizacao?: unknown;
  sincronizacao_em?: string | null;
  ultimo_contato?: string | null;
  clientes?: { nome: string } | null;
};

const GB = 1024 ** 3;

function emGb(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "—";
  const valor = bytes / GB;
  if (valor >= 1024) return `${(valor / 1024).toFixed(2)} TB`;
  return `${valor.toFixed(valor >= 100 ? 0 : 1)} GB`;
}

function minutosDesde(quando?: string | null) {
  if (!quando) return null;
  const min = (Date.now() - new Date(quando).getTime()) / 60000;
  return Number.isFinite(min) ? min : null;
}

function medicao(quando?: string | null) {
  const min = minutosDesde(quando);
  if (min === null) return "Sem sincronização: o servidor ainda não enviou os discos";
  const hora = new Date(quando as string).toLocaleString("pt-BR");
  const quanto = min < 1 ? "agora" : min < 60 ? `há ${Math.round(min)} min` : `há ${Math.round(min / 60)} h`;
  return `Medido ${quanto} · ${hora}`;
}

function sincronizacaoDe(s: ServidorComDiscos): Sincronizacao | null {
  const bruto = s.sincronizacao;
  return bruto && typeof bruto === "object" ? (bruto as Sincronizacao) : null;
}

function dvrsDoDisco(d: Disco): string[] {
  return Array.isArray(d.dvrs) ? (d.dvrs as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

function discosDe(s: ServidorComDiscos): Disco[] {
  const bruto = Array.isArray(s.discos) ? (s.discos as Disco[]) : [];
  return bruto.filter((d) => d && typeof d.id === "string" && d.id.length > 0);
}

function escolhidosDe(s: ServidorComDiscos): string[] {
  return Array.isArray(s.discos_gravacao)
    ? (s.discos_gravacao as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
}

type Vinculo = {
  servidor_id: string;
  dvr_id: string;
  disco_id: string;
  disco_disponivel: boolean | null;
  estado: string | null;
  canais_gravando: number | null;
  visto_em: string | null;
  dvrs?: { nome: string } | null;
};

const ESTADO_ROTULO: Record<string, string> = {
  gravando: "Gravando",
  aguardando_video: "Aguardando imagem",
  pausado: "Pausado",
  vinculado: "Vinculado (sem gravar)",
  disco_indisponivel: "Disco desconectado",
};

/** Sem sinal recente do servidor não mantemos "gravando" como estado ativo. */
function estadoDoVinculo(v: Vinculo) {
  const min = minutosDesde(v.visto_em);
  if (min === null || min > OBSOLETO_MIN) return "Sem sincronização";
  return ESTADO_ROTULO[v.estado ?? ""] ?? "Vinculado";
}

function DiscosPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { clienteId, setClienteId, clientes, bloqueado } = useClienteSelecionado();
  const servidores = useQuery({ ...servidoresQuery, refetchInterval: 20_000 });
  const vinculos = useQuery({
    queryKey: ["dvr-discos"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dvr_discos" as never)
        .select("servidor_id, dvr_id, disco_id, disco_disponivel, estado, canais_gravando, visto_em, dvrs(nome)");
      if (error) throw error;
      return (data ?? []) as unknown as Vinculo[];
    },
  });
  const podeEditar = can("discos.editar");
  const [servidorId, setServidorId] = useState("todos");
  const [discosAbertos, setDiscosAbertos] = useState<Record<string, boolean>>({});

  const salvar = useMutation({
    mutationFn: async (dados: { id: string; escolhidos: string[]; todos?: boolean }) => {
      const { error } = await supabase
        .from("servidores")
        .update({
          discos_gravacao: dados.escolhidos,
          ...(dados.todos === undefined ? {} : { gravar_todos_discos: dados.todos }),
        } as never)
        .eq("id", dados.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Discos de gravação atualizados. O servidor aplica na próxima consulta.");
      void qc.invalidateQueries({ queryKey: servidoresQuery.queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doCliente = ((servidores.data ?? []) as unknown as ServidorComDiscos[]).filter(
    (s) => !clienteId || s.cliente_id === clienteId,
  );
  const lista = servidorId === "todos" ? doCliente : doCliente.filter((s) => s.id === servidorId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discos"
        description="Espaço de cada HD dos servidores e escolha de onde as gravações são guardadas."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!bloqueado && (
              <div className="w-[220px]">
                <ComboSelect
                  value={clienteId || "todos"}
                  onChange={(v) => {
                    setClienteId(v === "todos" ? "" : v);
                    setServidorId("todos");
                  }}
                  options={[
                    { value: "todos", label: "Todos os clientes" },
                    ...clientes.map((c) => ({ value: c.id, label: c.nome })),
                  ]}
                  placeholder="Cliente"
                  searchPlaceholder="Pesquisar cliente..."
                />
              </div>
            )}
            <Select value={servidorId} onValueChange={setServidorId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Servidor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os servidores</SelectItem>
                {doCliente.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {lista.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum servidor para este cliente.
          </CardContent>
        </Card>
      )}

      {lista.map((s) => {
        const discos = discosDe(s);
        const escolhidos = escolhidosDe(s);
        const total = discos.reduce((acc, d) => acc + (d.total_bytes ?? 0), 0);
        const usado = discos.reduce((acc, d) => acc + (d.usado_bytes ?? 0), 0);
        const vinculosDoServidor = (vinculos.data ?? []).filter((v) => v.servidor_id === s.id);


        const todosDiscos = s.gravar_todos_discos === true;
        const gravacaoLigada = todosDiscos || escolhidos.length > 0;

        const alternar = (discoId: string, ligado: boolean) => {
          const novos = ligado
            ? [...new Set([...escolhidos, discoId])]
            : escolhidos.filter((v) => v !== discoId);
          salvar.mutate({ id: s.id, escolhidos: novos, todos: false });
        };

        /** Liga usando todos os discos disponíveis; desliga zerando a escolha. */
        const alternarGravacao = (ligado: boolean) => {
          if (ligado) salvar.mutate({ id: s.id, escolhidos, todos: escolhidos.length === 0 });
          else salvar.mutate({ id: s.id, escolhidos: [], todos: false });
        };

        return (
          <Card key={s.id}>
            <CardContent className="space-y-4 py-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    {s.nome}
                    {s.clientes?.nome && (
                      <span className="text-sm text-muted-foreground">· {s.clientes.nome}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{medicao(s.discos_em)}</p>
                  {(() => {
                    const sinc = sincronizacaoDe(s);
                    const min = minutosDesde(s.sincronizacao_em);
                    if (!sinc || min === null)
                      return (
                        <p className="text-sm text-amber-600">
                          Sem sincronização das informações de gravação — o servidor só enviou o
                          sinal de vida.
                        </p>
                      );
                    return (
                      <p className="text-sm text-muted-foreground">
                        {sinc.discos ?? 0} disco(s) · {sinc.arquivos_recebidos ?? 0} gravação(ões)
                        no último envio
                        {min > OBSOLETO_MIN ? " · informação desatualizada" : ""}
                      </p>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-4">
                  {discos.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      {emGb(usado)} usados de {emGb(total)}
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">
                        {gravacaoLigada ? "Gravação ligada" : "Gravação desligada"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {gravacaoLigada
                          ? todosDiscos
                            ? "Em qualquer disco disponível"
                            : `${escolhidos.length} disco(s) escolhido(s)`
                          : "Este servidor não vai gravar"}
                      </div>
                    </div>
                    <Switch
                      checked={gravacaoLigada}
                      disabled={!podeEditar || salvar.isPending}
                      onCheckedChange={alternarGravacao}
                      aria-label="Ativar ou desativar a gravação deste servidor"
                    />
                  </div>
                </div>
              </div>

              {discos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este servidor ainda não enviou a lista de discos.
                </p>
              ) : (
                <div className="space-y-3">
                  {discos.map((d) => {
                    const chave = `${s.id}:${d.id}`;
                    const aberto = discosAbertos[chave] === true;
                    const t = d.total_bytes ?? 0;
                    const u = d.usado_bytes ?? Math.max(0, t - (d.livre_bytes ?? 0));
                    const pct = t > 0 ? Math.min(100, Math.round((u / t) * 100)) : 0;
                    const ligado = escolhidos.includes(d.id);
                    const problema =
                      d.somente_leitura === true
                        ? "Somente leitura"
                        : d.saudavel === false
                          ? "Com falha"
                          : t > 0 && pct >= 95
                            ? "Quase cheio"
                            : null;
                    return (
                      <div key={d.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{d.rotulo || d.id}</span>
                              {d.ponto_montagem && (
                                <span className="text-sm text-muted-foreground">
                                  {d.ponto_montagem}
                                </span>
                              )}
                              {d.sistema_arquivos && (
                                <Badge variant="outline">{d.sistema_arquivos}</Badge>
                              )}
                              {d.removivel && <Badge variant="outline">Removível</Badge>}
                              {d.gravando && <Badge>Gravando</Badge>}
                              {problema && <Badge variant="destructive">{problema}</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {emGb(u)} usados · {emGb(d.livre_bytes ?? Math.max(0, t - u))} livres ·{" "}
                              {emGb(t)} no total
                            </p>
                            {d.diagnostico && (
                              <p className="text-sm text-destructive">{d.diagnostico}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="ghost" size="sm" aria-expanded={aberto} aria-controls={`gravacoes-${s.id}-${d.id}`} onClick={() => setDiscosAbertos((atuais) => ({ ...atuais, [chave]: !aberto }))}>
                              {aberto ? <ChevronDown /> : <ChevronRight />} Gravações por DVR
                            </Button>
                            <span className="text-sm text-muted-foreground">Gravar aqui</span>
                            <Switch
                              checked={ligado}
                              disabled={!podeEditar || salvar.isPending}
                              onCheckedChange={(v) => alternar(d.id, v)}
                            />
                          </div>
                        </div>
                        <Progress value={pct} className="mt-3 h-2" />
                        {aberto && <div id={`gravacoes-${s.id}-${d.id}`} className="mt-3"><DiscosGravacoes servidorId={s.id} discoId={d.id} dvrIds={dvrsDoDisco(d)} vinculos={vinculosDoServidor} /></div>}
                      </div>
                    );
                  })}

                  {escolhidos.filter((id) => !discos.some((d) => d.id === id)).length > 0 && (
                    <p className="text-sm text-destructive">
                      Há disco escolhido para gravação que não está mais conectado neste servidor.
                    </p>
                  )}

                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
