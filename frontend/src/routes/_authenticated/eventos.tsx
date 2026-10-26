import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, X, ImageOff, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, dvrsQuery, servidoresQuery } from "@/lib/queries";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { PageHeader } from "@/components/PageHeader";
import { ComboSelect } from "@/components/ComboSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/eventos")({
  head: () => ({
    meta: [
      { title: "Eventos — Sentinela VIEW" },
      { name: "description", content: "Eventos de portão aberto com foto, horário e validação." },
      { property: "og:title", content: "Eventos — Sentinela VIEW" },
      { property: "og:description", content: "Valide eventos de portão aberto e melhore a precisão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EventosPage,
});

type Evento = {
  id: string;
  dvr_id: string;
  canal: number;
  cliente_id: string | null;
  detalhe: string | null;
  ocorrido_em: string;
  snapshot: string | null;
  validacao: "pendente" | "correto" | "falso";
  validado_em: string | null;
};

const FILTROS_VALIDACAO = [
  { value: "todos", label: "Todos" },
  { value: "pendente", label: "Pendentes" },
  { value: "correto", label: "Corretos" },
  { value: "falso", label: "Errados" },
];

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function SeloValidacao({ v }: { v: Evento["validacao"] }) {
  if (v === "correto") return <Badge className="bg-primary text-primary-foreground">Correto</Badge>;
  if (v === "falso") return <Badge variant="destructive">Errado</Badge>;
  return <Badge variant="secondary">Pendente</Badge>;
}

function EventosPage() {
  const { can } = useAuth();
  const podeValidar = can("deteccao.editar");
  const qc = useQueryClient();
  const { clienteId: clienteGlobal } = useClienteSelecionado();
  const dvrs = useQuery(dvrsQuery);
  const clientes = useQuery(clientesQuery);
  const servidores = useQuery(servidoresQuery);
  const [clienteFiltro, setClienteFiltro] = useState(clienteGlobal);
  const clienteId = clienteFiltro;
  // acompanha a seleção global de cliente do topo do sistema
  useEffect(() => {
    setClienteFiltro(clienteGlobal);
    setServidorId("");
    setDvrId("");
  }, [clienteGlobal]);
  const [servidorId, setServidorId] = useState("");
  const [dvrId, setDvrId] = useState("");
  const [avancado, setAvancado] = useState(false);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [validacao, setValidacao] = useState("pendente");
  const [aberto, setAberto] = useState<Evento | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const eventosQ = useQuery({
    queryKey: ["eventos-portao", clienteId, servidorId, dvrId, validacao, de, ate],
    refetchInterval: 15000,
    queryFn: async () => {
      let q = supabase
        .from("eventos_deteccao" as never)
        .select("id, dvr_id, canal, cliente_id, detalhe, ocorrido_em, snapshot, validacao, validado_em")
        .eq("tipo", "portao_aberto")
        .order("ocorrido_em", { ascending: false })
        .limit(1000);
      if (clienteId) q = q.eq("cliente_id", clienteId);
      if (servidorId) q = q.eq("servidor_id", servidorId);
      if (dvrId) q = q.eq("dvr_id", dvrId);
      if (de) q = q.gte("ocorrido_em", new Date(`${de}T00:00:00-03:00`).toISOString());
      if (ate) q = q.lte("ocorrido_em", new Date(`${ate}T23:59:59.999-03:00`).toISOString());
      if (validacao !== "todos") q = q.eq("validacao", validacao);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Evento[];
    },
  });

  const nomeDvr = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dvrs.data ?? []) m.set(d.id, d.nome);
    return m;
  }, [dvrs.data]);

  const opcoesDvr = useMemo(
    () => [
      { value: "", label: "Todos os DVRs" },
      ...(dvrs.data ?? [])
        .filter((d) => (!clienteId || d.cliente_id === clienteId) && (!servidorId || d.servidor_id === servidorId))
        .map((d) => ({ value: d.id, label: d.nome })),
    ],
    [dvrs.data, clienteId, servidorId],
  );
  const opcoesCliente = useMemo(
    () => [{ value: "", label: "Todos os clientes" }, ...(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))],
    [clientes.data],
  );
  const opcoesServidor = useMemo(
    () => [
      { value: "", label: "Todos os servidores" },
      ...(servidores.data ?? [])
        .filter((sv) => !clienteId || !sv.cliente_id || sv.cliente_id === clienteId)
        .map((sv) => ({ value: sv.id, label: sv.nome })),
    ],
    [servidores.data, clienteId],
  );

  async function validar(ev: Evento, correto: boolean) {
    setSalvando(ev.id);
    const { error } = await supabase.rpc("validar_evento_deteccao" as never, {
      _id: ev.id,
      _correto: correto,
    } as never);
    setSalvando(null);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success(
      correto
        ? "Marcado como correto. A foto entrou como referência de portão aberto."
        : "Marcado como errado. A foto entrou como referência de portão fechado.",
    );
    setAberto((a) => (a?.id === ev.id ? { ...a, validacao: correto ? "correto" : "falso" } : a));
    qc.invalidateQueries({ queryKey: ["eventos-portao"] });
  }

  const pag = usePaginacao(eventosQ.data ?? [], 20);
  const eventos = pag.visiveis;

  return (
    <div>
      <PageHeader
        title="Eventos"
        description="Eventos de portão aberto. Marque se cada um está certo ou errado: a foto vira referência e a detecção fica mais precisa."
      />
      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <ComboSelect value={clienteFiltro} onChange={(v) => { setClienteFiltro(v); setServidorId(""); setDvrId(""); }} options={opcoesCliente} placeholder="Todos os clientes" />
            </div>
            <div className="space-y-1.5">
              <Label>Servidor</Label>
              <ComboSelect value={servidorId} onChange={(v) => { setServidorId(v); setDvrId(""); }} options={opcoesServidor} placeholder="Todos os servidores" />
            </div>
            <div className="space-y-1.5">
              <Label>DVR</Label>
              <ComboSelect value={dvrId} onChange={setDvrId} options={opcoesDvr} placeholder="Todos os DVRs" />
            </div>
            <div className="space-y-1.5">
              <Label>Validação</Label>
              <ComboSelect value={validacao} onChange={setValidacao} options={FILTROS_VALIDACAO} />
            </div>
            <Button variant={avancado ? "secondary" : "outline"} onClick={() => setAvancado((a) => !a)}>
              <SlidersHorizontal className="mr-1 h-4 w-4" /> Filtro avançado
            </Button>
          </div>
          {avancado && (
            <div className="grid gap-3 md:grid-cols-[200px_200px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label>Data inicial</Label>
                <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data final</Label>
                <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
              {(de || ate) && (
                <Button variant="ghost" onClick={() => { setDe(""); setAte(""); }}>Limpar datas</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {eventosQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum evento de portão aberto encontrado.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {eventos.map((ev) => (
            <Card key={ev.id} className="overflow-hidden">
              <button type="button" className="block w-full bg-muted" onClick={() => setAberto(ev)}>
                {ev.snapshot ? (
                  <img src={ev.snapshot} alt="Foto do evento" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center gap-2 text-sm text-muted-foreground">
                    <ImageOff className="h-4 w-4" /> Sem foto
                  </div>
                )}
              </button>
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{nomeDvr.get(ev.dvr_id) ?? "DVR"}</div>
                    <div className="text-xs text-muted-foreground">
                      Câmera {ev.canal + 1} · {dataHora(ev.ocorrido_em)}
                    </div>
                  </div>
                  <SeloValidacao v={ev.validacao} />
                </div>
                {podeValidar && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={ev.validacao === "correto" ? "default" : "outline"}
                      className="flex-1"
                      disabled={salvando === ev.id}
                      onClick={() => validar(ev, true)}
                    >
                      <Check className="mr-1 h-4 w-4" /> Correto
                    </Button>
                    <Button
                      size="sm"
                      variant={ev.validacao === "falso" ? "destructive" : "outline"}
                      className="flex-1"
                      disabled={salvando === ev.id}
                      onClick={() => validar(ev, false)}
                    >
                      <X className="mr-1 h-4 w-4" /> Errado
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {pag.total > 0 && <div className="mt-4"><Paginacao {...pag} rotulo="eventos" /></div>}

      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-w-3xl">
          {aberto && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {nomeDvr.get(aberto.dvr_id) ?? "DVR"} — Câmera {aberto.canal + 1}
                </DialogTitle>
              </DialogHeader>
              {aberto.snapshot ? (
                <img src={aberto.snapshot} alt="Foto do evento" className="w-full rounded-md" />
              ) : (
                <p className="text-sm text-muted-foreground">Este evento chegou sem foto.</p>
              )}
              <div className="space-y-1 text-sm">
                <div>Horário: {dataHora(aberto.ocorrido_em)}</div>
                {aberto.detalhe && <div>Detalhe: {aberto.detalhe}</div>}
                <div className="flex items-center gap-2">
                  Validação: <SeloValidacao v={aberto.validacao} />
                </div>
              </div>
              {podeValidar && (
                <div className="flex gap-2">
                  <Button disabled={salvando === aberto.id} onClick={() => validar(aberto, true)}>
                    <Check className="mr-1 h-4 w-4" /> Correto (portão aberto)
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={salvando === aberto.id}
                    onClick={() => validar(aberto, false)}
                  >
                    <X className="mr-1 h-4 w-4" /> Errado (portão fechado)
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
