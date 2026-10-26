import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  FUSOS_BRASIL,
  FUSO_PADRAO,
  ROTULO_ESTADO,
  horarioManualValido,
  type EstadoAjuste,
  type ModoAjuste,
} from "@/lib/ajuste-horario";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { diagnosticoDvr, formatarHoraDvr, linhasTelemetriaDvr } from "@/lib/dvr-telemetria";

type DvrInfo = {
  id: string;
  nome: string;
  fabricante?: string | null;
  modelo?: string | null;
  firmware?: string | null;
  serial?: string | null;
  status_hd?: string | null;
  data_hora_dvr?: string | null;
  dados_dvr_atualizados_em?: string | null;
  fuso_horario?: string | null;
};

export function InformacaoDvr({ dvr, podeAjustar = false }: { dvr: DvrInfo; podeAjustar?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const diag = diagnosticoDvr(dvr);
  const coleta = dvr.dados_dvr_atualizados_em
    ? new Date(dvr.dados_dvr_atualizados_em).toLocaleString("pt-BR")
    : "Indisponível";
  const linha = (rotulo: string, valor?: string | null) => (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium break-all">{valor || "—"}</span>
    </div>
  );
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex flex-col items-start gap-1">
        {diag.estado === "sem_dados" ? (
          <span className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">—</span>
        ) : diag.estado === "ok" ? (
          <Badge className="cursor-pointer bg-emerald-600 text-primary-foreground hover:bg-emerald-600/90">STATUS OK</Badge>
        ) : (
          diag.problemas.map((p) => (
            <Badge key={p} variant="destructive" className="cursor-pointer">{p}</Badge>
          ))
        )}
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Informações do DVR — {dvr.nome}</DialogTitle>
          </DialogHeader>
          <div>
            {linha("Situação", diag.estado === "ok" ? "STATUS OK" : diag.problemas.join(", "))}
            {linha("HD", dvr.status_hd?.trim() || "Indisponível")}
            {linha("Data e hora do DVR", formatarHoraDvr(dvr.data_hora_dvr) ?? "Indisponível")}
            {linha("Fuso configurado", dvr.fuso_horario || "America/Sao_Paulo")}
            {linha("Coletado em", coleta)}
            {linha("Fabricante", dvr.fabricante)}
            {linha("Modelo", dvr.modelo)}
            {linha("Firmware", dvr.firmware)}
            {linha("Serial", dvr.serial)}
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {linhasTelemetriaDvr(dvr).slice(2).map((t) => <p key={t}>{t}</p>)}
          </div>
          {podeAjustar && <AjusteHorario dvr={dvr} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Pedido = {
  id: string;
  estado: EstadoAjuste;
  modo: ModoAjuste;
  fuso_horario: string;
  horario_manual: string | null;
  horario_anterior: string | null;
  horario_confirmado: string | null;
  erro: string | null;
};

/** Hora local do DVR (sem fuso) mostrada como o DVR mostra, sem converter para o navegador. */
function horaLocal(v: string | null) {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : v;
}

function agoraNoFuso(fuso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { data: `${p["year"]}-${p["month"]}-${p["day"]}`, hora: `${p["hour"]}:${p["minute"]}:${p["second"]}` };
}

function AjusteHorario({ dvr }: { dvr: DvrInfo }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<ModoAjuste>("ntp");
  const [fuso, setFuso] = useState(dvr.fuso_horario || FUSO_PADRAO);
  const [data, setData] = useState(() => agoraNoFuso(dvr.fuso_horario || FUSO_PADRAO).data);
  const [hora, setHora] = useState(() => agoraNoFuso(dvr.fuso_horario || FUSO_PADRAO).hora);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = async () => {
    const { data: rows } = await (supabase as unknown as { from: (t: string) => any })
      .from("dvr_ajustes_horario")
      .select("id, estado, modo, fuso_horario, horario_manual, horario_anterior, horario_confirmado, erro")
      .eq("dvr_id", dvr.id)
      .order("criado_em", { ascending: false })
      .limit(1);
    const p = (rows?.[0] ?? null) as Pedido | null;
    setPedido((ant) => {
      if (ant?.estado === "pendente" && p?.id === ant.id && p.estado === "concluido")
        qc.invalidateQueries();
      return p;
    });
  };
  useEffect(() => {
    carregar();
  }, [dvr.id]);
  useEffect(() => {
    if (pedido?.estado !== "pendente") return;
    const t = setInterval(carregar, 3000);
    return () => clearInterval(t);
  }, [pedido?.estado, pedido?.id]);

  const horarioManual = `${data}T${hora.length === 5 ? hora + ":00" : hora}`;
  const enviar = async () => {
    if (modo === "manual" && !horarioManualValido(horarioManual)) {
      toast.error("Data e hora inválidas");
      return;
    }
    const alvo = modo === "manual" ? `${horaLocal(horarioManual)} (${fuso})` : `horário do NTP.br no fuso ${fuso}`;
    if (!window.confirm(`Ajustar o relógio do DVR "${dvr.nome}" para ${alvo}?\n\nIsso pode alterar a sequência das gravações do equipamento.`)) return;
    setEnviando(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch(`/api/dvrs/${dvr.id}/ajuste-horario`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
        body: JSON.stringify(
          modo === "manual" ? { modo, fuso_horario: fuso, horario_manual: horarioManual } : { modo, fuso_horario: fuso },
        ),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.erro ?? "Falha ao pedir ajuste de horário");
      toast.success("Pedido enviado ao servidor local");
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao pedir ajuste de horário");
    } finally {
      setEnviando(false);
    }
  };

  const cor: Record<EstadoAjuste, string> = {
    pendente: "bg-amber-500 text-primary-foreground hover:bg-amber-500",
    concluido: "bg-emerald-600 text-primary-foreground hover:bg-emerald-600",
    falhou: "bg-destructive text-destructive-foreground hover:bg-destructive",
    expirado: "bg-muted text-muted-foreground hover:bg-muted",
  };

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">Ajustar horário</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Modo</Label>
          <Select value={modo} onValueChange={(v) => setModo(v as ModoAjuste)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ntp">Sincronizar pelo NTP</SelectItem>
              <SelectItem value="manual">Definir data e hora</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fuso horário</Label>
          <Select value={fuso} onValueChange={setFuso}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FUSOS_BRASIL.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {modo === "manual" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Data</Label>
            <Input type="date" min="2000-01-01" max="2099-12-31" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hora (com segundos)</Label>
            <Input type="time" step={1} value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={enviar} disabled={enviando || pedido?.estado === "pendente"}>
          Ajustar horário
        </Button>
        {pedido && <Badge className={cor[pedido.estado]}>{ROTULO_ESTADO[pedido.estado]}</Badge>}
      </div>
      {pedido && pedido.estado !== "pendente" && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>Modo: {pedido.modo === "manual" ? "Data e hora definidas" : "NTP"} · Fuso: {pedido.fuso_horario}</p>
          {pedido.modo === "manual" && <p>Pedido: {horaLocal(pedido.horario_manual)}</p>}
          {pedido.estado === "concluido" && (
            <>
              <p>Antes: {pedido.horario_anterior ?? "—"}</p>
              <p>Confirmado no DVR: {pedido.horario_confirmado ?? "—"}</p>
            </>
          )}
          {pedido.estado === "falhou" && <p className="text-destructive">Falha: {pedido.erro ?? "sem detalhe"}. Confira o relógio antes de pedir de novo.</p>}
          {pedido.estado === "expirado" && <p>O servidor local não respondeu a tempo. Você pode pedir de novo.</p>}
        </div>
      )}
    </div>
  );
}
