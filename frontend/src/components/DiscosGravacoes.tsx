import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canaisConfigurados, diasGravados, mediaDias, type ConfiguracaoGravacaoDvr, type TrechoDisco } from "@/lib/discos-gravacoes";

type Vinculo = { dvr_id: string; estado: string | null; visto_em: string | null; canais_gravando: number | null; disco_id: string };
type EstadoCamera = { dvr_id: string; canal: number; estado: string; atualizado_em: string; diagnostico: string | null; qualidade: string | null };

const rotulos: Record<string, string> = { gravando: "Gravando", aguardando_video: "Aguardando imagem", pausado: "Pausado", vinculado: "Sem gravar", disco_indisponivel: "Disco desconectado", conectando: "Conectando", erro: "Erro", parado: "Parado" };
function recente(data: string | null) {
  return data !== null && Number.isFinite(Date.parse(data)) && Date.now() - Date.parse(data) <= 600_000;
}
function dias(n: number | null) {
  return n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dias`;
}

export function DiscosGravacoes({ servidorId, discoId, dvrIds, vinculos }: { servidorId: string; discoId: string; dvrIds: string[]; vinculos: Vinculo[] }) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const configuracoes = useQuery({
    queryKey: ["discos-configuracoes", servidorId], refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dvrs").select("id, nome, canais, canais_gravacao, gravar_todos_canais, dias_backup").eq("servidor_id", servidorId).order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ConfiguracaoGravacaoDvr[];
    },
  });
  const estados = useQuery({
    queryKey: ["discos-estados", servidorId], refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("gravacao_status" as never).select("dvr_id, canal, estado, atualizado_em, diagnostico, qualidade").eq("servidor_id", servidorId);
      if (error) throw error;
      return (data ?? []) as unknown as EstadoCamera[];
    },
  });
  const catalogo = useQuery({
    queryKey: ["discos-dias-gravados", servidorId], staleTime: 60_000,
    queryFn: async () => {
      const trechos: TrechoDisco[] = [];
      let cursor: string | null = null;
      for (;;) {
        let q = supabase.from("arquivos_gravados").select("id, dvr_id, canal, camera_nome, inicio, fim, duracao_segundos").eq("servidor_id", servidorId).eq("disponivel", true).order("id").limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data, error } = await q;
        if (error) throw error;
        const pagina = data ?? [];
        trechos.push(...pagina);
        const ultimo = pagina.at(-1);
        if (pagina.length < 1000 || !ultimo) return trechos;
        cursor = ultimo.id;
      }
    },
  });
  const vinculosDoDisco = vinculos.filter((v) => v.disco_id === discoId);
  const dvrs = (configuracoes.data ?? []).filter((d) => vinculosDoDisco.some((v) => v.dvr_id === d.id) || (dvrIds.includes(d.id) && !vinculos.some((v) => v.dvr_id === d.id)));
  const carregando = configuracoes.isPending || estados.isPending || catalogo.isPending;
  const erro = configuracoes.error ?? estados.error ?? catalogo.error;
  const trechosPorCamera = new Map<string, TrechoDisco[]>();
  for (const t of catalogo.data ?? []) {
    const chave = `${t.dvr_id}:${t.canal}`;
    const itens = trechosPorCamera.get(chave) ?? [];
    itens.push(t);
    trechosPorCamera.set(chave, itens);
  }

  return (
    <div className="space-y-3 border-t pt-3">
        {erro ? <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">Não foi possível consultar as gravações.<Button size="sm" variant="outline" onClick={() => { void configuracoes.refetch(); void estados.refetch(); void catalogo.refetch(); }}>Tentar novamente</Button></div> : carregando ? <p className="text-sm text-muted-foreground">Consultando câmeras e gravações…</p> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead className="min-w-48">Nome do DVR</TableHead><TableHead className="min-w-40">Câmeras</TableHead><TableHead className="min-w-36">Dias em gravações</TableHead><TableHead className="min-w-32">Dias gravados</TableHead><TableHead className="min-w-36">Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {dvrs.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Nenhum DVR vinculado a este HD.</TableCell></TableRow>}
                {dvrs.map((d) => {
                  const canais = canaisConfigurados(d);
                  const detalhes = selecionado === d.id;
                  const vinculo = vinculosDoDisco.find((v) => v.dvr_id === d.id);
                  const cameras = canais.map((canal) => {
                    const trechos = trechosPorCamera.get(`${d.id}:${canal}`) ?? [];
                    const estado = estados.data?.find((e) => e.dvr_id === d.id && e.canal === canal);
                    const ultimo = trechos.reduce<string | null>((atual, t) => { const fim = t.fim ?? t.inicio; return !atual || Date.parse(fim) > Date.parse(atual) ? fim : atual; }, null);
                    return { canal, nome: trechos.find((t) => t.camera_nome)?.camera_nome ?? `Canal ${canal}`, dias: diasGravados(trechos), estado, ultimo };
                  });
                  const gravando = cameras.filter((c) => c.estado?.estado === "gravando" && recente(c.estado.atualizado_em)).length;
                  const status = gravando > 0 ? `${gravando}/${canais.length} gravando` : vinculo && recente(vinculo.visto_em) ? rotulos[vinculo.estado ?? ""] ?? "Sem gravar" : "Sem sincronização";
                  return <Fragment key={d.id}>
                    <TableRow data-state={detalhes ? "selected" : undefined}>
                      <TableCell><Button variant="ghost" className="h-auto justify-start whitespace-normal px-0 text-left" aria-expanded={detalhes} aria-controls={`cameras-${discoId}-${d.id}`} onClick={() => setSelecionado(detalhes ? null : d.id)}>{detalhes ? <ChevronDown /> : <ChevronRight />}{d.nome}</Button></TableCell>
                      <TableCell><span>{canais.length} câmera(s)</span><p className="max-w-64 break-words text-xs text-muted-foreground">{canais.length ? `Canais ${canais.join(", ")}` : "Nenhuma configurada"}</p></TableCell>
                      <TableCell>{dias(canais.length ? d.dias_backup : null)}</TableCell>
                      <TableCell>{dias(mediaDias(cameras.map((c) => c.dias)))}</TableCell>
                      <TableCell><Badge variant={gravando ? "default" : "outline"}>{status}</Badge></TableCell>
                    </TableRow>
                    {detalhes && <TableRow id={`cameras-${discoId}-${d.id}`}><TableCell colSpan={5} className="bg-muted/30 p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-medium">{d.nome}{vinculo && <span className="break-all text-xs font-normal text-muted-foreground">· Disco {vinculo.disco_id}</span>}</div>
                      <Table><TableHeader><TableRow><TableHead>Câmera</TableHead><TableHead>Dias configurados</TableHead><TableHead>Dias gravados</TableHead><TableHead>Última gravação</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                        {cameras.map((c) => <TableRow key={c.canal}><TableCell>{c.nome}<p className="text-xs text-muted-foreground">Canal {c.canal}</p></TableCell><TableCell>{dias(d.dias_backup)}</TableCell><TableCell>{dias(c.dias)}</TableCell><TableCell className="whitespace-nowrap">{c.ultimo ? new Date(c.ultimo).toLocaleString("pt-BR") : "Sem gravações"}</TableCell><TableCell><Badge variant={c.estado?.estado === "gravando" && recente(c.estado.atualizado_em) ? "default" : "outline"}>{c.estado && recente(c.estado.atualizado_em) ? rotulos[c.estado.estado] ?? c.estado.estado : "Sem sincronização"}</Badge>{c.estado?.diagnostico && <p className="mt-1 max-w-64 break-words text-xs text-muted-foreground">{c.estado.diagnostico}</p>}{c.estado?.qualidade && <p className="mt-1 text-xs text-muted-foreground">{c.estado.qualidade}</p>}</TableCell></TableRow>)}
                        {!cameras.length && <TableRow><TableCell colSpan={5}>Nenhuma câmera configurada para gravação.</TableCell></TableRow>}
                      </TableBody></Table>
                    </TableCell></TableRow>}
                  </Fragment>;
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Dias em gravações: média configurada das câmeras. Dias gravados: média do tempo disponível no catálogo deste servidor, descontando lacunas. O catálogo não identifica o HD de cada trecho.</p>
          </>
        )}
    </div>
  );
}