import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Eye } from "lucide-react";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { ComboSelect } from "@/components/ComboSelect";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { servidoresQuery, dvrsQuery } from "@/lib/queries";


export const Route = createFileRoute("/_authenticated/log")({
  head: () => ({
    meta: [
      { title: "Log de atividades — Sentinela VIEW" },
      { name: "description", content: "Registro de tudo que os usuários fazem no sistema." },
      { property: "og:title", content: "Log de atividades — Sentinela VIEW" },
      { property: "og:description", content: "Histórico de ações dos usuários." },
    ],
  }),
  component: LogPage,
});

type Log = {
  id: string;
  user_id: string | null;
  user_nome: string | null;
  user_email: string | null;
  acao: string;
  tabela: string;
  registro_id: string | null;
  descricao: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  created_at: string;
  cliente_id: string | null;
};

const AREAS = [
  "Clientes",
  "Servidores",
  "DVRs",
  "Câmeras",
  "Licenças",
  "Visualização",
  "Mosaicos",
  "Ronda",
  "Detecção",
  "Gerenciamento de telas",
  "Ajuda",
  "Personalização",
  "Usuários",
  "Perfis de acesso",
  "Funções de usuário",
  "Permissões",
];

const IGNORAR = new Set(["updated_at", "created_at"]);

// Nomes amigáveis dos campos, iguais aos usados nas telas.
const NOME_CAMPOS: Record<string, string> = {
  nome: "Nome",
  descricao: "Descrição",
  documento: "Documento",
  contato_nome: "Nome do contato",
  contato_email: "E-mail do contato",
  contato_telefone: "Telefone do contato",
  observacoes: "Observações",
  max_servidores: "Máximo de servidores",
  max_licencas_dvr: "Máximo de DVRs",
  ativo: "Ativo",
  cliente_id: "Cliente",
  servidor_id: "Servidor",
  fabricante: "Fabricante",
  modelo: "Modelo",
  canais: "Quantidade de câmeras",
  usuario: "Usuário",
  senha: "Senha",
  ip_interno: "IP interno",
  porta_http_interna: "Porta HTTP interna",
  porta_rtsp_interna: "Porta RTSP interna",
  porta_servico_interna: "Porta de serviço interna",
  ip_externo: "IP externo",
  porta_http_externa: "Porta HTTP externa",
  porta_rtsp_externa: "Porta RTSP externa",
  porta_servico_externa: "Porta de serviço externa",
  cloud: "Cloud",
  porta_cloud: "Porta do Cloud",
  porta_http_cloud: "Porta HTTP do Cloud",
  dias_backup: "Tempo de backup (dias)",
  canais_gravacao: "Câmeras gravadas",
  perfil_minimo: "Perfil que pode ver",
  perfis_ids: "Perfis personalizados que podem ver",
  prioridade_conexao: "Prioridade de conexão",
  licenca: "Licença",
  ip: "IP",
  online: "Online",
  offline_apos_minutos: "Offline após (minutos)",
  colunas: "Colunas",
  linhas: "Linhas",
  segundos: "Duração (segundos)",
  ordem: "Ordem",
  email: "E-mail",
  avatar_url: "Foto",
  perfil_id: "Perfil",
  base_role: "Perfil base",
  permissions: "Permissões",
  clientes: "Clientes liberados",
  restaurar_sessao: "Restaurar telas ao entrar",
  canal: "Câmera (canal)",
  dvr_id: "DVR",
  layout_id: "Layout",
  ronda_id: "Ronda",
  sensibilidade: "Sensibilidade",
  ignorados: "Áreas ignoradas",
  template: "Formato do mosaico",
  slots: "Câmeras do layout",
  monitores: "Monitores",
  retencao_segundos: "Tempo na tela (segundos)",
  permissoes_permitidas: "Telas liberadas",
  deteccoes: "Detecções liberadas",
  titulo: "Título",
  resumo: "Resumo",
  categoria: "Categoria",
  rota: "Tela",
};

function nomeCampo(chave: string) {
  return NOME_CAMPOS[chave] ?? chave.replace(/_/g, " ");
}

function acaoVariant(acao: string): "default" | "secondary" | "destructive" {
  if (acao === "criou") return "default";
  if (acao === "excluiu") return "destructive";
  return "secondary";
}

const CAMPOS_ID = new Set(["cliente_id", "servidor_id", "dvr_id", "clientes", "servidor_principal_id"]);
const DATA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function fmt(v: unknown, nomes?: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (nomes && typeof v === "string" && nomes.has(v)) return nomes.get(v)!;
  if (nomes && Array.isArray(v)) return v.length === 0 ? "Nenhum" : v.map((x) => nomes.get(String(x)) ?? String(x)).join(", ");
  if (typeof v === "string" && DATA_ISO.test(v)) return new Date(v).toLocaleString("pt-BR");
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.length === 0 ? "Nenhuma" : v.join(", ");
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>).map(([k, x]): string => `${nomeCampo(k)}: ${fmt(x)}`).join(" · ");
  return String(v);
}

function LogPage() {
  const [busca, setBusca] = useState("");
  const [area, setArea] = useState("todas");
  const [acao, setAcao] = useState("todas");
  const [detalhe, setDetalhe] = useState<Log | null>(null);
  const { clienteId, setClienteId, clientes, bloqueado } = useClienteSelecionado();
  const nomeCliente = (id: string | null) =>
    id ? (clientes.find((c) => c.id === id)?.nome ?? "—") : "—";

  const logs = useQuery({
    queryKey: ["logs", area, acao, clienteId],
    queryFn: async () => {
      let q = supabase
        .from("logs_auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (area !== "todas") q = q.eq("tabela", area);
      if (acao !== "todas") q = q.eq("acao", acao);
      if (clienteId) q = q.eq("cliente_id", clienteId);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Log[];
    },
    refetchInterval: 30000,
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!t) return logs.data ?? [];
    return (logs.data ?? []).filter((l) =>
      [l.descricao, l.user_nome, l.user_email].some((s) => s?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(t)),
    );
  }, [logs.data, busca]);

  const pag = usePaginacao(filtrados);
  const servidores = useQuery(servidoresQuery);
  const dvrs = useQuery(dvrsQuery);
  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes) m.set(c.id, c.nome);
    for (const x of servidores.data ?? []) m.set(x.id, x.nome);
    for (const x of dvrs.data ?? []) m.set(x.id, x.nome);
    return m;
  }, [clientes, servidores.data, dvrs.data]);

  const mudancas = useMemo(() => {
    if (!detalhe) return [];
    const a = detalhe.antes ?? {};
    const d = detalhe.depois ?? {};
    const chaves = Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).filter((k) => !IGNORAR.has(k) && k in NOME_CAMPOS && k !== "senha");
    return chaves
      .map((k) => ({ campo: k, antes: a[k], depois: d[k] }))
      .filter((m) => detalhe.acao !== "editou" || JSON.stringify(m.antes) !== JSON.stringify(m.depois));
  }, [detalhe]);

  return (
    <div>
      <PageHeader
        title="Log de atividades"
        description="Tudo que os usuários criam, editam ou excluem fica registrado aqui."
        actions={
          <Button variant="outline" onClick={() => logs.refetch()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${logs.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid gap-4 p-5 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Buscar</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Usuário, e-mail ou descrição" />
          </div>
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ComboSelect
              value={clienteId}
              onChange={setClienteId}
              options={[
                ...(bloqueado ? [] : [{ value: "", label: "Todos os clientes" }]),
                ...clientes.map((c) => ({ value: c.id, label: c.nome })),
              ]}
              placeholder="Todos os clientes"
              searchPlaceholder="Pesquisar cliente..."
              disabled={bloqueado}
            />
          </div>
          <div className="space-y-2">
            <Label>Área</Label>
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {AREAS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ação</Label>
            <Select value={acao} onValueChange={setAcao}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="criou">Criou</SelectItem>
                <SelectItem value="editou">Editou</SelectItem>
                <SelectItem value="excluiu">Excluiu</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.visiveis.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(l.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{l.user_nome ?? "Agente do servidor"}</div>
                    {l.user_email && <div className="text-xs text-muted-foreground">{l.user_email}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={acaoVariant(l.acao)} className="capitalize">
                      {l.acao}
                    </Badge>
                  </TableCell>
                  <TableCell>{l.tabela}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {nomeCliente(l.cliente_id)}
                  </TableCell>
                  <TableCell className="max-w-md truncate">{l.descricao}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => setDetalhe(l)} title="Ver detalhes">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pag.visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {logs.isLoading ? "Carregando..." : "Nenhum registro encontrado."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="registros" />
        </CardContent>
      </Card>

      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="capitalize">{detalhe?.descricao}</DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {detalhe.user_nome ?? "Agente do servidor"} · {new Date(detalhe.created_at).toLocaleString("pt-BR")}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campo</TableHead>
                    {detalhe.acao !== "criou" && <TableHead>Antes</TableHead>}
                    {detalhe.acao !== "excluiu" && <TableHead>Depois</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mudancas.map((m) => (
                    <TableRow key={m.campo}>
                      <TableCell>{nomeCampo(m.campo)}</TableCell>
                      {detalhe.acao !== "criou" && (
                        <TableCell className="max-w-xs break-words text-muted-foreground">{fmt(m.antes, CAMPOS_ID.has(m.campo) ? nomes : undefined)}</TableCell>
                      )}
                      {detalhe.acao !== "excluiu" && (
                        <TableCell className="max-w-xs break-words">{fmt(m.depois, CAMPOS_ID.has(m.campo) ? nomes : undefined)}</TableCell>
                      )}
                    </TableRow>
                  ))}
                  {mudancas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Só atualizações automáticas do sistema.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
