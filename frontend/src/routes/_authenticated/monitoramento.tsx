import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MonitorSmartphone, RotateCcw, LayoutGrid, ScanEye, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  forcarLayout,
  identificarMonitoresDoUsuario,
  identificarTela,
  iniciarTelasDoUsuario,
} from "@/lib/monitoramento.functions";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { ComboSelect } from "@/components/ComboSelect";
import { SortHeader, comparar, type Ordem } from "@/components/SortHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mosaicoDe } from "@/lib/mosaicos";
import {
  OrganizacaoTelas,
  type MonitorSalvo,
  type SessaoMonitor,
} from "@/components/OrganizacaoTelas";


export const Route = createFileRoute("/_authenticated/monitoramento")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de telas — Sentinela VIEW" },
      {
        name: "description",
        content: "Veja quem está logado, em qual tela está e altere o mosaico em tempo real.",
      },
      { property: "og:title", content: "Gerenciamento de telas — Sentinela VIEW" },
      { property: "og:description", content: "Usuários online e controle remoto de mosaicos." },
    ],
  }),
  component: MonitoramentoPage,
});

const ROTULO_ROTA: Record<string, string> = {
  "/dashboard": "Início",
  "/clientes": "Clientes",
  "/servidores": "Servidores",
  "/dvrs": "DVRs",
  "/importacoes": "Importações",
  "/visualizacao": "Visualização",
  "/ronda": "Ronda",
  "/reproducao": "Reprodução",
  "/relatorios": "Relatórios",
  "/usuarios": "Usuários",
  "/log": "Log",
  "/personalizacao": "Personalização",
  "/monitoramento": "Monitoramento",
};

const ROLE_LABEL: Record<string, string> = {
  master: "Master",
  admin: "Administrador",
  operador: "Operador",
  visualizador: "Visualizador",
};

type Campo = "usuario" | "cliente" | "tela" | "visto";

// navegadores freiam abas em segundo plano: uma janela maior evita que
// telas realmente abertas sumam da lista
const JANELA_MS = 75_000;

type Sessao = {
  id: string;
  user_id: string;
  sessao: string;
  rota: string;
  cliente_id: string | null;
  layout_id: string | null;
  layout_forcado: string | null;
  visto_em: string;
  updated_at: string | null;
  created_at: string;
  monitores?: MonitorSalvo[] | null;
  monitor_numero?: number | null;
};

/** horário oficial do servidor (o relógio do computador do usuário pode estar errado) */
function vistoOficial(s: Sessao) {
  const a = new Date(s.visto_em).getTime();
  const b = s.updated_at ? new Date(s.updated_at).getTime() : 0;
  return new Date(Math.max(Number.isFinite(a) ? a : 0, b)).toISOString();
}

type Layout = {
  id: string;
  nome: string;
  cliente_id: string | null;
  colunas: number;
  linhas: number;
  template: string | null;
};

function tempoRelativo(iso: string) {
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 10) return "agora";
  if (seg < 60) return `há ${seg}s`;
  const min = Math.round(seg / 60);
  return `há ${min}min`;
}

function MonitoramentoPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const podeControlar = can("monitoramento.ver");
  const enviarLayout = useServerFn(forcarLayout);
  const enviarIdentificacao = useServerFn(identificarTela);
  const enviarIdentificacaoMonitores = useServerFn(identificarMonitoresDoUsuario);
  const enviarAbertura = useServerFn(iniciarTelasDoUsuario);

  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [ordem, setOrdem] = useState<Ordem<Campo>>({ campo: "usuario", asc: true });

  const [alvo, setAlvo] = useState<Sessao | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  const [buscaMosaico, setBuscaMosaico] = useState("");
  const [, setTick] = useState(0);

  const sessoes = useQuery({
    queryKey: ["sessoes-usuario"],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessoes_usuario")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Sessao[];
    },
  });

  const perfis = useQuery({
    queryKey: ["perfis-monitoramento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome, email");
      if (error) throw error;
      return data;
    },
  });

  const papeis = useQuery({
    queryKey: ["papeis-monitoramento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data;
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes-monitoramento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const layouts = useQuery({
    queryKey: ["layouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("layouts_visualizacao")
        .select("id, nome, cliente_id, colunas, linhas, template")
        .order("nome");
      if (error) throw error;
      return data as Layout[];
    },
  });

  // clientes vinculados ao usuário-alvo (vazio = acesso a todos)
  const clientesDoAlvo = useQuery({
    queryKey: ["clientes-do-alvo", alvo?.user_id],
    enabled: !!alvo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_clientes")
        .select("cliente_id")
        .eq("user_id", alvo!.user_id);
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.cliente_id);
      const todos = clientes.data ?? [];
      const lista = ids.length ? todos.filter((c) => ids.includes(c.id)) : todos;
      return lista;
    },
  });

  useEffect(() => {
    if (!alvo) return;
    setBuscaMosaico("");
    const lista = clientesDoAlvo.data ?? [];
    // cliente atual da sessão se ele estiver na lista; único cliente vem travado
    const preferido = alvo.cliente_id && lista.some((c) => c.id === alvo.cliente_id)
      ? alvo.cliente_id
      : lista.length === 1
        ? lista[0]!.id
        : "";
    setClienteEscolhido(preferido);
  }, [alvo, clientesDoAlvo.data]);

  // atualiza os "há Xs" e limpa quem ficou inativo
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // tempo real
  useEffect(() => {
    const canal = supabase
      .channel("monitoramento-sessoes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessoes_usuario" },
        () => qc.invalidateQueries({ queryKey: ["sessoes-usuario"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);

  const linhas = useMemo(() => {
    const nomePerfil = (id: string) => (perfis.data ?? []).find((p) => p.id === id);
    const papel = (id: string) => (papeis.data ?? []).find((r) => r.user_id === id)?.role ?? null;
    const nomeCliente = (id: string | null) =>
      id ? ((clientes.data ?? []).find((c) => c.id === id)?.nome ?? "—") : "—";
    const layoutDe = (id: string | null) =>
      id ? ((layouts.data ?? []).find((l) => l.id === id) ?? null) : null;

    const agora = Date.now();
    const ativas = (sessoes.data ?? []).filter(
      (s) => agora - new Date(vistoOficial(s)).getTime() < JANELA_MS,
    );

    // numeração das telas por usuário: a janela principal é a Tela 1
    const numero = new Map<string, number>();
    const porUsuario = new Map<string, Sessao[]>();
    for (const s of ativas) {
      const atual = porUsuario.get(s.user_id) ?? [];
      atual.push(s);
      porUsuario.set(s.user_id, atual);
    }
    for (const [, lista] of porUsuario) {
      lista
        .slice()
        .sort((a, b) => {
          const ea = a.sessao.startsWith("tela-") ? 1 : 0;
          const eb = b.sessao.startsWith("tela-") ? 1 : 0;
          if (ea !== eb) return ea - eb;
          return a.created_at.localeCompare(b.created_at);
        })
        .forEach((s, i) => numero.set(s.id, i + 1));
    }

    let lista = ativas
      .map((s) => {
        const p = nomePerfil(s.user_id);
        const layout = layoutDe(s.layout_id);
        return {
          sessao: s,
          numeroTela: numero.get(s.id) ?? 1,
          totalTelas: (porUsuario.get(s.user_id) ?? []).length,
          usuario: p?.nome ?? "Usuário",
          email: p?.email ?? "",
          papel: papel(s.user_id),
          cliente: nomeCliente(s.cliente_id),
          tela: ROTULO_ROTA[s.rota] ?? s.rota,
          layout: layout
            ? `${layout.nome} · ${mosaicoDe(layout.template, layout.colunas, layout.linhas).nome}`
            : "—",
          visto: vistoOficial(s),
        };
      });

    if (filtroCliente) lista = lista.filter((l) => l.sessao.cliente_id === filtroCliente);
    const termo = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (termo) {
      lista = lista.filter((l) =>
        [l.usuario, l.email, l.tela, l.cliente, l.layout]
          .join(" ")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
          .includes(termo),
      );
    }

    return lista.sort((a, b) => {
      const cmp = comparar(
        a[ordem.campo as keyof typeof a],
        b[ordem.campo as keyof typeof b],
        ordem.asc,
      );
      if (cmp !== 0) return cmp;
      // desempate: mantém as telas do mesmo usuário juntas e em ordem (1, 2, 3...)
      if (a.sessao.user_id !== b.sessao.user_id) {
        return a.sessao.user_id.localeCompare(b.sessao.user_id);
      }
      return a.numeroTela - b.numeroTela;
    });
  }, [sessoes.data, perfis.data, papeis.data, clientes.data, layouts.data, busca, filtroCliente, ordem]);



  // todas as sessões ativas (sem os filtros da tabela) para organizar as telas
  const sessoesMonitor = useMemo<SessaoMonitor[]>(() => {
    const agora = Date.now();
    const ativas = (sessoes.data ?? []).filter(
      (s) => agora - new Date(vistoOficial(s)).getTime() < JANELA_MS,
    );
    const porUsuario = new Map<string, Sessao[]>();
    for (const s of ativas) {
      const atual = porUsuario.get(s.user_id) ?? [];
      atual.push(s);
      porUsuario.set(s.user_id, atual);
    }
    const numero = new Map<string, number>();
    for (const [, lista] of porUsuario) {
      lista
        .slice()
        .sort((a, b) => {
          const ea = a.sessao.startsWith("tela-") ? 1 : 0;
          const eb = b.sessao.startsWith("tela-") ? 1 : 0;
          if (ea !== eb) return ea - eb;
          return a.created_at.localeCompare(b.created_at);
        })
        .forEach((s, i) => numero.set(s.id, i + 1));
    }
    return ativas.map((s) => {
      const p = (perfis.data ?? []).find((item) => item.id === s.user_id);
      const layout = s.layout_id
        ? ((layouts.data ?? []).find((l) => l.id === s.layout_id) ?? null)
        : null;
      return {
        id: s.id,
        userId: s.user_id,
        usuario: p?.nome ?? "Usuário",
        email: p?.email ?? "",
        clienteId: s.cliente_id,
        layoutId: s.layout_id,
        layoutNome: layout ? layout.nome : "sem mosaico",
        numeroTela: numero.get(s.id) ?? 1,
        monitores: (s.monitores as MonitorSalvo[] | null) ?? null,
        monitorNumero: s.monitor_numero ?? null,
        previa: ((s as unknown as { previa?: string | null }).previa) ?? null,
      };
    });
  }, [sessoes.data, perfis.data, layouts.data]);

  const identificarVarios = async (userId: string) => {
    try {
      await enviarIdentificacaoMonitores({ data: { userId } });
      toast.success("Identificação enviada para todos os monitores do usuário");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const iniciarMosaicos = async (userId: string) => {
    try {
      const resultado = await enviarAbertura({ data: { userId } });
      toast.success(
        `Solicitação enviada para abrir ${resultado.quantidade} tela${resultado.quantidade === 1 ? "" : "s"}.`,
      );
      qc.invalidateQueries({ queryKey: ["sessoes-usuario"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const identificar = async (sessaoId: string, numeroTela: number) => {
    try {
      await enviarIdentificacao({ data: { sessaoId, rotulo: "Identificar monitor" } });
      toast.success(`Identificação enviada para a Tela ${numeroTela}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const aplicar = async (sessaoId: string, layoutId: string | null) => {
    try {
      await enviarLayout({ data: { sessaoId, layoutId } });
      toast.success(layoutId ? "Mosaico enviado ao usuário" : "Controle devolvido ao usuário");
      setAlvo(null);
      qc.invalidateQueries({ queryKey: ["sessoes-usuario"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const layoutsDoAlvo = useMemo(() => {
    const termo = buscaMosaico.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (layouts.data ?? [])
      .filter((l) => !clienteEscolhido || l.cliente_id === clienteEscolhido)
      .filter((l) => !termo || l.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo));
  }, [layouts.data, clienteEscolhido, buscaMosaico]);

  return (
    <div>
      <PageHeader
        title="Gerenciamento de telas"
        description="Usuários conectados agora, em qual tela estão, com troca de mosaico em tempo real."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={sessoes.isFetching}
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["sessoes-usuario"] });
                qc.invalidateQueries({ queryKey: ["perfis-monitoramento"] });
                qc.invalidateQueries({ queryKey: ["papeis-monitoramento"] });
                qc.invalidateQueries({ queryKey: ["clientes-monitoramento"] });
                qc.invalidateQueries({ queryKey: ["layouts"] });
              }}
            >
              <RefreshCw className={`h-4 w-4 ${sessoes.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Badge variant="secondary" className="gap-1">
              <MonitorSmartphone className="h-3.5 w-3.5" />
              {linhas.length} online
            </Badge>
          </div>
        }
      />


      <OrganizacaoTelas
        sessoes={sessoesMonitor}
        clientes={clientes.data ?? []}
        layouts={layouts.data ?? []}
        podeControlar={podeControlar}
        usuarioInicial={user?.id}
        onIdentificar={(userId) => void identificarVarios(userId)}
        onIniciar={(userId) => void iniciarMosaicos(userId)}
      />



      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar usuário, tela ou mosaico..."
            className="w-full sm:max-w-xs"
          />
          <div className="w-full sm:w-64">
            <ComboSelect
              value={filtroCliente}
              onChange={setFiltroCliente}
              options={[
                { value: "", label: "Todos os clientes" },
                ...(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
              ]}
              placeholder="Todos os clientes"
              searchPlaceholder="Pesquisar cliente..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader campo="usuario" ordem={ordem} setOrdem={setOrdem}>
                  Usuário
                </SortHeader>
                <TableHead>Perfil</TableHead>
                <TableHead>Tela</TableHead>
                <SortHeader campo="cliente" ordem={ordem} setOrdem={setOrdem}>
                  Cliente
                </SortHeader>
                <SortHeader campo="tela" ordem={ordem} setOrdem={setOrdem}>
                  Página
                </SortHeader>
                <TableHead>Mosaico</TableHead>
                <SortHeader campo="visto" ordem={ordem} setOrdem={setOrdem}>
                  Atividade
                </SortHeader>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.sessao.id}>
                  <TableCell>
                    <p className="font-medium">{l.usuario}</p>
                    <p className="text-xs text-muted-foreground">{l.email}</p>
                  </TableCell>
                  <TableCell>{l.papel ? (ROLE_LABEL[l.papel] ?? l.papel) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={l.totalTelas > 1 ? "default" : "outline"}>
                      Tela {l.numeroTela}
                    </Badge>
                    {l.totalTelas > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        de {l.totalTelas}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{l.cliente}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.tela}</Badge>
                    {l.sessao.sessao.startsWith("tela-") && (
                      <Badge variant="secondary" className="ml-1.5">
                        tela extra
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{l.layout}</span>
                    {l.sessao.layout_forcado && (
                      <Badge variant="secondary" className="ml-2">
                        controlado
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tempoRelativo(l.visto)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!podeControlar}
                        onClick={() => setAlvo(l.sessao)}
                      >
                        <LayoutGrid className="mr-1 h-4 w-4" /> Alterar mosaico
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!podeControlar}
                        title="Mostrar o número da tela no monitor do usuário"
                        onClick={() => void identificar(l.sessao.id, l.numeroTela)}
                      >
                        <ScanEye className="mr-1 h-4 w-4" /> Identificar monitor
                      </Button>
                      {l.sessao.layout_forcado && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!podeControlar}
                          title="Devolver o controle ao usuário"
                          onClick={() => void aplicar(l.sessao.id, null)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!linhas.length && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Nenhum usuário conectado no momento.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar mosaico do usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O mosaico escolhido é aplicado na hora na tela de Visualização ou Ronda do usuário.
            </p>
            <ComboSelect
              value={clienteEscolhido}
              onChange={setClienteEscolhido}
              options={(clientesDoAlvo.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Selecione o cliente"
              searchPlaceholder="Pesquisar cliente..."
              disabled={(clientesDoAlvo.data ?? []).length === 1}
            />
            <Input
              value={buscaMosaico}
              onChange={(e) => setBuscaMosaico(e.target.value)}
              placeholder="Pesquisar mosaico..."
              className="w-full"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {layoutsDoAlvo.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => alvo && void aplicar(alvo.id, l.id)}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm transition hover:border-primary/60 hover:bg-accent"
                >
                  <span>{l.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {mosaicoDe(l.template, l.colunas, l.linhas).nome}
                  </span>
                </button>
              ))}
              {!layoutsDoAlvo.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum layout disponível para este cliente.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
