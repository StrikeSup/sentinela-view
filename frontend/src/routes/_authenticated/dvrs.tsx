import { createFileRoute } from "@tanstack/react-router";
import { linhasTelemetriaDvr, diagnosticoDvr } from "@/lib/dvr-telemetria";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mosaicoAutomatico } from "@/lib/mosaicos";
import {
  clientesQuery,
  dvrsQuery,
  fabricantesQuery,
  gravacaoStatusQuery,
  servidoresQuery,
  type GravacaoStatus,
} from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { AjudaJanela } from "@/components/AjudaJanela";
import { FUSOS_BRASIL, FUSO_PADRAO } from "@/lib/ajuste-horario";
import { InformacaoDvr } from "@/components/InformacaoDvr";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComboSelect } from "@/components/ComboSelect";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";


import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SortHeader, type Ordem } from "@/components/SortHeader";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, ExternalLink, Copy, Eye, EyeOff, GripVertical, Wifi, WifiOff, Power, RefreshCw, Info, HardDrive } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";


export const Route = createFileRoute("/_authenticated/dvrs")({
  head: () => ({
    meta: [
      { title: "DVRs — Sentinela VIEW" },
      { name: "description", content: "Cadastro de DVRs com portas internas, externas, cloud e backup." },
      { property: "og:title", content: "DVRs — Sentinela VIEW" },
      { property: "og:description", content: "Cadastro de DVRs e vínculo com servidores." },
    ],
  }),
  component: DvrsPage,
});

type Form = {
  id?: string;
  cliente_id: string;
  servidor_id: string;
  nome: string;
  fabricante: string;
  modelo: string;
  canais: number;
  canais_gravacao: number[];
  gravar_todos_canais: boolean;
  usuario: string;
  senha: string;
  ip_interno: string;
  porta_http_interna: string;
  porta_rtsp_interna: string;
  porta_servico_interna: string;
  ip_externo: string;
  porta_http_externa: string;
  porta_rtsp_externa: string;
  porta_servico_externa: string;
  cloud: string;
  porta_cloud: string;
  porta_http_cloud: string;
  prioridade_conexao: string[];
  perfis_ids: string[];
  observacao: string;
  dias_backup: number;
  ativo: boolean;
  perfil_minimo: string;
  perfis_base: ("visualizador" | "operador" | "admin" | "master")[];
  fuso_horario: string;
};

const PERFIS = [
  { value: "visualizador", label: "Visualizador" },
  { value: "operador", label: "Operador" },
  { value: "admin", label: "Administrador" },
  { value: "master", label: "Master" },
];

const ORDEM_PERFIS = ["visualizador", "operador", "admin", "master"];


const vazio: Form = {
  cliente_id: "",
  servidor_id: "",
  nome: "",
  fabricante: "",
  modelo: "",
  canais: 0,
  canais_gravacao: [],
  gravar_todos_canais: false,
  usuario: "",
  senha: "",
  ip_interno: "",
  porta_http_interna: "",
  porta_rtsp_interna: "",
  porta_servico_interna: "",
  ip_externo: "",
  porta_http_externa: "",
  porta_rtsp_externa: "",
  porta_servico_externa: "",
  cloud: "",
  porta_cloud: "",
  porta_http_cloud: "",
  prioridade_conexao: ["interno", "externo", "cloud"],
  perfis_ids: [],
  observacao: "",
  dias_backup: 7,
  ativo: true,
  perfil_minimo: "visualizador",
  perfis_base: ["visualizador", "operador", "admin", "master"],
  fuso_horario: FUSO_PADRAO,
};

const ESTADOS_GRAVACAO: Record<string, string> = {
  conectando: "conectando",
  aguardando_video: "aguardando imagem",
  gravando: "gravando",
  reconectando: "reconectando",
  pausada: "pausada",
  erro: "erro",
};

const num = (v: string) => (v === "" ? null : Number(v));

function DvrsPage() {
  const { can, user, isAdmin, isMaster } = useAuth();
  const qc = useQueryClient();
  // O servidor atualiza o cadastro pelo sinal de vida; a tela acompanha sozinha.
  const dvrs = useQuery({ ...dvrsQuery, refetchInterval: 15000, refetchOnWindowFocus: true });
  const clientes = useQuery(clientesQuery);
  const { clienteId: clienteGlobal, setClienteId: setClienteGlobal } = useClienteSelecionado();
  const servidores = useQuery({ ...servidoresQuery, refetchInterval: 15000, refetchOnWindowFocus: true });
  const gravacaoStatus = useQuery(gravacaoStatusQuery);

  // Estado real informado pelo servidor local: só "gravando" significa imagem sendo guardada.
  const statusPorDvr = useMemo(() => {
    const mapa = new Map<string, GravacaoStatus[]>();
    for (const s of gravacaoStatus.data ?? []) {
      const atual = mapa.get(s.dvr_id) ?? [];
      atual.push(s);
      mapa.set(s.dvr_id, atual);
    }
    return mapa;
  }, [gravacaoStatus.data]);

  const gravacaoDoDvr = (d: {
    id: string;
    canais: number | null;
    canais_gravacao?: number[] | null;
    servidor_id?: string | null;
  }) => {
    const dv = d as { gravar_todos_canais?: boolean | null };
    const total = Math.max(0, d.canais || 0);
    const selecionados = (
      dv.gravar_todos_canais === true
        ? Array.from({ length: total }, (_, i) => i + 1)
        : [...(d.canais_gravacao ?? [])]
    ).sort((a, b) => a - b);

    const srv = (servidores.data ?? []).find((s) => s.id === d.servidor_id) as
      | {
          ultimo_contato?: string | null;
          offline_apos_minutos?: number | null;
          gravacao?: {
            pausada_localmente?: boolean;
            disco_configurado?: boolean;
            habilitada?: boolean;
            diagnostico?: string | null;
          } | null;
        }
      | undefined;

    const limite = (srv?.offline_apos_minutos || 10) * 60000;
    const idadeMs = srv?.ultimo_contato ? Date.now() - new Date(srv.ultimo_contato).getTime() : null;
    const semSinal = idadeMs === null || idadeMs > limite;
    const idade =
      idadeMs === null
        ? "Nenhum sinal recebido"
        : idadeMs < 60000
          ? `Último sinal há ${Math.max(0, Math.round(idadeMs / 1000))} s`
          : `Último sinal há ${Math.round(idadeMs / 60000)} min`;

    // Diagnóstico do disco (alpha 41): disco indisponível nunca conta como gravação ativa.
    const diagnosticoServidor = (srv?.gravacao?.diagnostico ?? "").trim();
    const discoIndisponivel = /disco/i.test(diagnosticoServidor);

    let aviso = "";
    if (selecionados.length > 0) {
      if (semSinal) aviso = "Sem sinal do servidor";
      else if (srv?.gravacao?.disco_configurado === false) aviso = "Disco não configurado";
      else if (discoIndisponivel) aviso = "Disco indisponível";
      else if (srv?.gravacao?.pausada_localmente === true) aviso = "Pausada no servidor";
    }

    const estados = (statusPorDvr.get(d.id) ?? []).filter((s) => selecionados.includes(s.canal));
    const gravando =
      semSinal || discoIndisponivel
        ? 0
        : estados.filter((s) => s.estado === "gravando").length;
    const detalhes = [...estados]
      .sort((a, b) => a.canal - b.canal)
      .map(
        (s) =>
          `Câmera ${s.canal}: ${ESTADOS_GRAVACAO[s.estado] ?? s.estado}${
            s.diagnostico ? ` — ${s.diagnostico}` : ""
          }`,
      );

    return { selecionados, gravando, detalhes, aviso, idade, diagnosticoServidor };
  };

  /**
   * Status de conectividade informado pelo Agent (alpha 54).
   * "indeterminado" nunca é mostrado como offline, e servidor sem sinal
   * vira "status desatualizado" em vez de derrubar todos os DVRs.
   */
  const statusDoDvr = (d: {
    id: string;
    ativo: boolean;
    online: boolean;
    servidor_id?: string | null;
    status_texto?: string | null;
    status_motivo?: string | null;
    status_origem?: string | null;
    status_rtsp?: string | null;
    status_http?: string | null;
    status_video?: string | null;
    status_atualizado_em?: string | null;
    ultimo_sinal_em?: string | null;
    ultimo_status_em?: string | null;
    status_hd?: string | null;
    data_hora_dvr?: string | null;
    dados_dvr_atualizados_em?: string | null;
  }) => {
    const srv = (servidores.data ?? []).find((x) => x.id === d.servidor_id) as
      | { ultimo_contato?: string | null; offline_apos_minutos?: number | null }
      | undefined;
    const limite = (srv?.offline_apos_minutos || 10) * 60000;
    const idadeMs = srv?.ultimo_contato ? Date.now() - new Date(srv.ultimo_contato).getTime() : null;
    const servidorSemSinal = idadeMs === null || idadeMs > limite;

    const bruto = (d.status_texto ?? (d.online ? "online" : "indeterminado")).toLowerCase();
    const estado: "online" | "offline" | "indeterminado" =
      bruto === "online" ? "online" : bruto === "offline" ? "offline" : "indeterminado";

    const quando = (v?: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
    const detalhes = [
      d.status_motivo ? `Motivo: ${d.status_motivo}` : null,
      d.status_origem ? `Confirmado por: ${d.status_origem}` : null,
      `Verificado em: ${quando(d.status_atualizado_em ?? d.ultimo_status_em)}`,
      `Último sinal positivo: ${quando(d.ultimo_sinal_em)}`,
      d.status_rtsp || d.status_http || d.status_video
        ? `RTSP: ${d.status_rtsp ?? "—"} · HTTP: ${d.status_http ?? "—"} · Vídeo: ${d.status_video ?? "—"}`
        : null,
      ...linhasTelemetriaDvr(d),
    ].filter((x): x is string => !!x);

    if (!d.ativo) return { rotulo: "Desativado", variante: "outline" as const, estado, detalhes };
    if (servidorSemSinal)
      return {
        rotulo: "Servidor sem sinal",
        variante: "outline" as const,
        estado: "indeterminado" as const,
        detalhes: ["Status desatualizado: o servidor local parou de enviar sinal.", ...detalhes],
      };
    if (estado === "online") return { rotulo: "Online", variante: "default" as const, estado, detalhes };
    if (estado === "offline") return { rotulo: "Offline", variante: "secondary" as const, estado, detalhes };
    return { rotulo: "Indeterminado", variante: "outline" as const, estado, detalhes };
  };

  const [aberto, setAberto] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(vazio);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroInfo, setFiltroInfo] = useState("todos");
  const [filtroServidor, setFiltroServidor] = useState("todos");
  const filtroCliente = clienteGlobal || "todos";
  const setFiltroCliente = (v: string) => setClienteGlobal(v === "todos" ? "" : v);
  type CampoOrdem = "nome" | "cliente" | "servidor" | "interno" | "backup" | "status";
  const [ordem, setOrdem] = useState<Ordem<CampoOrdem>>({ campo: "nome", asc: true });
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [ultimoIndice, setUltimoIndice] = useState<number | null>(null);
  const [verSenha, setVerSenha] = useState(false);

  const lista = useMemo(() => {
    const termo = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    type DvrRow = NonNullable<typeof dvrs.data>[number];
    const valor = (d: DvrRow): string | number => {
      switch (ordem.campo) {
        case "cliente":
          return ((d as { clientes?: { nome: string } }).clientes?.nome ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        case "servidor":
          return ((d as { servidores?: { nome: string } }).servidores?.nome ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        case "interno":
          return (d.ip_interno ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        case "backup":
          return d.dias_backup;
        case "status":
          return !d.ativo
            ? "desativado"
            : statusDoDvr(d as Parameters<typeof statusDoDvr>[0]).estado;
        default:
          return d.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      }
    };
    return (dvrs.data ?? [])
      .filter((d) => (filtroCliente === "todos" ? true : d.cliente_id === filtroCliente))
      .filter((d) =>
        filtroServidor === "todos"
          ? true
          : filtroServidor === "sem"
            ? !d.servidor_id
            : d.servidor_id === filtroServidor,
      )
      .filter((d) => {
        if (filtroStatus === "todos") return true;
        const st = statusDoDvr(d as Parameters<typeof statusDoDvr>[0]);
        if (filtroStatus === "desativado") return !d.ativo;
        return d.ativo && st.estado === filtroStatus;
      })
      .filter((d) => {
        if (filtroInfo === "todos") return true;
        const diag = diagnosticoDvr(d as Parameters<typeof diagnosticoDvr>[0]);
        if (filtroInfo === "ok") return diag.estado === "ok";
        if (filtroInfo === "sem_dados") return diag.estado === "sem_dados";
        if (filtroInfo === "hd") return diag.problemas.includes("HD com problema");
        if (filtroInfo === "hora") return diag.problemas.includes("Hora incorreta");
        return true;
      })
      .filter((d) =>
        termo
          ? [
              d.nome,
              d.fabricante,
              d.modelo,
              d.ip_interno,
              d.ip_externo,
              (d as { clientes?: { nome: string } }).clientes?.nome,
              (d as { servidores?: { nome: string } }).servidores?.nome,
            ]
              .filter(Boolean)
              .some((v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo))
          : true,
      )
      .sort((a, b) => {
        const va = valor(a);
        const vb = valor(b);
        const c =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), "pt-BR");
        return ordem.asc ? c : -c;
      });
  }, [dvrs.data, busca, filtroCliente, filtroServidor, filtroStatus, filtroInfo, ordem]);

  const pag = usePaginacao(lista);
  const visiveis = pag.visiveis;

  /** DVRs ativos da lista atual com HD com problema (cartão de resumo). */
  const hdProblema = useMemo(
    () =>
      lista.filter(
        (d) =>
          d.ativo &&
          diagnosticoDvr(d as Parameters<typeof diagnosticoDvr>[0]).problemas.includes(
            "HD com problema",
          ),
      ).length,
    [lista],
  );


  const idsVisiveis = visiveis.map((d) => d.id);
  const todosVisiveisSelecionados =
    idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionados.includes(id));

  const alternarTodos = () => {
    setUltimoIndice(null);
    setSelecionados((atual) =>
      todosVisiveisSelecionados
        ? atual.filter((id) => !idsVisiveis.includes(id))
        : Array.from(new Set([...atual, ...idsVisiveis])),
    );
  };

  const alternarLinha = (indice: number, shift: boolean) => {
    const id = idsVisiveis[indice]!;
    if (shift && ultimoIndice !== null) {
      const [ini, fim] = ultimoIndice < indice ? [ultimoIndice, indice] : [indice, ultimoIndice];
      const faixa = idsVisiveis.slice(ini, fim + 1);
      setSelecionados((atual) => Array.from(new Set([...atual, ...faixa])));
      setUltimoIndice(indice);
      return;
    }
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
    setUltimoIndice(indice);
  };


  const perfisQuery = useQuery({
    queryKey: ["perfis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("perfis")
        .select("id, cliente_id, nome")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const servidoresDoCliente = (servidores.data ?? []).filter(
    (s) => s.cliente_id === form.cliente_id,
  );

  const perfisDoCliente = (perfisQuery.data ?? []).filter(
    (p) => p.cliente_id === form.cliente_id,
  );

  // Papéis + perfis personalizados do cliente em um único campo.
  // Os perfis personalizados ficam logo abaixo de Operador, e Administrador/Master
  // só aparecem para quem é administrador ou master.
  const opcoesPerfilVisao = [
    ...PERFIS.filter((p) => p.value === "visualizador" || p.value === "operador"),
    ...perfisDoCliente.map((p) => ({ value: `perfil:${p.id}`, label: p.nome })),
    ...(isAdmin ? PERFIS.filter((p) => p.value === "admin") : []),
    ...(isMaster ? PERFIS.filter((p) => p.value === "master") : []),
  ];

  // Apenas os perfis exatamente marcados têm acesso (sem hierarquia de superiores).
  const perfisSelecionados = [
    ...form.perfis_base,
    ...form.perfis_ids.map((id) => `perfil:${id}`),
  ];


  const fabricantes = useQuery(fabricantesQuery);
  // Se o cliente tem apenas um servidor, já vem preenchido
  useEffect(() => {
    if (form.cliente_id && !form.servidor_id && servidoresDoCliente.length === 1) {
      setForm((f) => ({ ...f, servidor_id: servidoresDoCliente[0]!.id }));
    }
  }, [form.cliente_id, form.servidor_id, servidoresDoCliente]);


  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.fabricante.trim()) throw new Error("Selecione o fabricante");
      const payload = {
        cliente_id: f.cliente_id,
        servidor_id: f.servidor_id || null,
        nome: f.nome,
        fabricante: f.fabricante || null,
        modelo: f.modelo || null,
        canais: f.canais,
        canais_gravacao: f.gravar_todos_canais
          ? Array.from({ length: f.canais }, (_, i) => i + 1)
          : f.canais_gravacao,
        gravar_todos_canais: f.gravar_todos_canais,
        usuario: f.usuario || null,
        senha: f.senha || null,
        ip_interno: f.ip_interno || null,
        porta_http_interna: num(f.porta_http_interna),
        porta_rtsp_interna: num(f.porta_rtsp_interna),
        porta_servico_interna: num(f.porta_servico_interna),
        ip_externo: f.ip_externo || null,
        porta_http_externa: num(f.porta_http_externa),
        porta_rtsp_externa: num(f.porta_rtsp_externa),
        porta_servico_externa: num(f.porta_servico_externa),
        cloud: f.cloud || null,
        porta_cloud: num(f.porta_cloud),
        porta_http_cloud: num(f.porta_http_cloud),
        prioridade_conexao: f.prioridade_conexao,
        perfis_ids: f.perfis_ids,
        perfis_base: f.perfis_base,
        observacao: f.observacao || null,
        dias_backup: f.dias_backup,
        ativo: f.ativo,
        perfil_minimo: f.perfil_minimo as "master" | "admin" | "operador" | "visualizador",
        fuso_horario: f.fuso_horario || FUSO_PADRAO,
      };
      /** Pede ao servidor local para acertar o relógio do DVR no fuso escolhido. */
      const pedirAjusteHorario = async (dvrId: string, fuso: string) => {
        const { data: s } = await supabase.auth.getSession();
        const res = await fetch(`/api/dvrs/${dvrId}/ajuste-horario`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
          body: JSON.stringify({ fuso_horario: fuso }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.erro ?? "Falha ao pedir ajuste de horário");
        }
      };
      /**
       * Todo DVR tem um layout com TODAS as suas câmeras. Ao criar, o layout
       * nasce junto; ao editar (inclusive quando o número de canais muda,
       * por detecção do servidor), o layout existente é atualizado.
       */
      const sincronizarLayout = async (
        dvr: {
          id: string;
          nome: string;
          canais: number | null;
          cliente_id: string;
        },
        forcar = true,
      ) => {
        const total = Math.max(1, Math.min(64, dvr.canais || 1));
        const auto = mosaicoAutomatico(total);
        const slots = Array.from({ length: total }, (_, i) => ({
          dvr_id: dvr.id,
          canal: i + 1,
        })) as unknown as Json;
        const dados = {
          nome: dvr.nome,
          colunas: auto.colunas,
          linhas: auto.linhas,
          template: `auto-${total}`,
          slots,
          cliente_id: dvr.cliente_id,
        };

        const { data: existentes } = await supabase
          .from("layouts_visualizacao")
          .select("id, slots, template")
          .eq("cliente_id", dvr.cliente_id)
          .like("template", "auto-%");
        const doDvr = (existentes ?? []).find((l) => {
          const s = Array.isArray(l.slots) ? (l.slots as { dvr_id?: string }[]) : [];
          return s.length > 0 && s.every((x) => x?.dvr_id === dvr.id);
        });

        if (doDvr) {
          // Só regravamos o layout quando o modelo/quantidade de canais muda;
          // edições comuns (IP, usuário, nome etc.) preservam o layout atual.
          if (!forcar) return;
          const { error } = await supabase
            .from("layouts_visualizacao")
            .update(dados)
            .eq("id", doDvr.id);
          if (error) throw error;
          return;
        }
        const { error } = await supabase
          .from("layouts_visualizacao")
          .insert({ ...dados, criado_por: user?.id ?? null });
        if (error) throw error;
      };

      if (f.id) {
        const { error } = await supabase.from("dvrs").update(payload as never).eq("id", f.id);
        if (error) throw error;
        const anterior = dvrs.data?.find((d) => d.id === f.id);
        // Fuso mudou: agenda o acerto do relógio no servidor local.
        if ((anterior as { fuso_horario?: string | null } | undefined)?.fuso_horario !== payload.fuso_horario) {
          try {
            await pedirAjusteHorario(f.id, payload.fuso_horario);
            toast.success("Ajuste de horário solicitado — o servidor local vai acertar o relógio em instantes.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao pedir ajuste de horário");
          }
        }
        const mudouModelo =
          !anterior ||
          anterior.modelo !== payload.modelo ||
          anterior.canais !== payload.canais;
        await sincronizarLayout(
          {
            id: f.id,
            nome: payload.nome,
            canais: payload.canais,
            cliente_id: payload.cliente_id,
          },
          mudouModelo,
        );
        return;
      }
      const { data: novo, error } = await supabase
        .from("dvrs")
        .insert(payload as never)
        .select("id, nome, canais, cliente_id")
        .single();
      if (error) throw error;
      await sincronizarLayout(novo);
      // DVR novo: já agenda o acerto do relógio no fuso escolhido.
      try {
        await pedirAjusteHorario(novo.id, payload.fuso_horario);
      } catch {
        // O servidor local ainda pode não ter conectado neste DVR; o ajuste pode ser refeito na edição.
      }
    },
    onSuccess: () => {
      toast.success("DVR salvo");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["dvrs"] });
      void qc.invalidateQueries({ queryKey: ["layouts"] });
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dvrs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("DVR excluído");
      void qc.invalidateQueries({ queryKey: ["dvrs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirVarios = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("dvrs").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      toast.success(`${ids.length} DVR(s) excluído(s)`);
      setSelecionados([]);
      setUltimoIndice(null);
      void qc.invalidateQueries({ queryKey: ["dvrs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternarAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("dvrs").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.ativo ? "DVR ativado" : "DVR desativado");
      void qc.invalidateQueries({ queryKey: ["dvrs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Renovar conexão: marca o DVR com um novo pedido de reconexão. O gatilho
   * do banco avisa o servidor local (config_atualizada_em), que desconecta e
   * reconecta este DVR no próximo ciclo de consulta.
   */
  const [reconectando, setReconectando] = useState<string | null>(null);
  const reconectar = useMutation({
    mutationFn: async (id: string) => {
      setReconectando(id);
      const { error } = await supabase
        .from("dvrs")
        .update({ reconectar_em: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      toast.success("Reconexão solicitada — o servidor local vai reconectar este DVR em instantes."),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setReconectando(null),
  });

  /** Renovar conexão de todos os selecionados de uma vez (uma única atualização). */
  const [reconectandoVarios, setReconectandoVarios] = useState(false);
  const reconectarVarios = useMutation({
    mutationFn: async (ids: string[]) => {
      setReconectandoVarios(true);
      const { error } = await supabase
        .from("dvrs")
        .update({ reconectar_em: new Date().toISOString() } as never)
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      toast.success(
        `Reconexão solicitada para ${ids.length} DVR(s) — o servidor local vai reconectá-los em instantes.`,
      );
      setSelecionados([]);
      setUltimoIndice(null);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setReconectandoVarios(false),
  });

  const campo = (label: string, key: keyof Form, tipo = "text") => (
    <div className="space-y-2" data-ajuda={`dvr-${String(key).replaceAll("_", "-")}`}>
      <Label>{label}</Label>
      <Input
        type={tipo}
        value={String(form[key] ?? "")}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: tipo === "number" ? Number(e.target.value) : e.target.value,
          } as Form)
        }
      />
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">DVRs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Endereços internos, externos, cloud e tempo de backup por equipamento.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Wifi className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Online</p>
                <p className="font-display text-xl font-bold">
                  {
                    lista.filter(
                      (d) =>
                        d.ativo &&
                        statusDoDvr(d as Parameters<typeof statusDoDvr>[0]).estado === "online",
                    ).length
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="rounded-lg bg-muted/10 p-2 text-muted-foreground">
                <WifiOff className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Offline</p>
                <p className="font-display text-xl font-bold">
                  {
                    lista.filter(
                      (d) =>
                        d.ativo &&
                        statusDoDvr(d as Parameters<typeof statusDoDvr>[0]).estado === "offline",
                    ).length
                  }
                </p>
              </div>
            </div>
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-3",
                hdProblema > 0 && "border-destructive/40 bg-destructive/5",
              )}
            >
              <div
                className={cn(
                  "rounded-lg p-2",
                  hdProblema > 0 ? "bg-destructive/10 text-destructive" : "bg-muted/10 text-muted-foreground",
                )}
              >
                <HardDrive className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs uppercase tracking-wide",
                    hdProblema > 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  HD com problema
                </p>
                <p
                  className={cn(
                    "font-display text-xl font-bold",
                    hdProblema > 0 && "text-destructive",
                  )}
                >
                  {hdProblema}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="rounded-lg bg-muted/10 p-2 text-muted-foreground">
                <Power className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Desativados</p>
                <p className="font-display text-xl font-bold">
                  {lista.filter((d) => !d.ativo).length}
                </p>
              </div>
            </div>
          </div>
        </div>
        {can("dvrs.criar") && (
          <Button
            onClick={() => {
              setForm({
                ...vazio,
                cliente_id: clienteGlobal || (clientes.data?.length === 1 ? clientes.data[0]!.id : ""),
              });
              setAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Novo DVR
          </Button>
        )}
      </div>

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
          <div className="sm:w-56">
            <ComboSelect
              value={filtroServidor}
              onChange={setFiltroServidor}
              options={[
                { value: "todos", label: "Todos os servidores" },
                ...(servidores.data ?? [])
                  .filter((s) => (filtroCliente === "todos" ? true : (s as { cliente_id?: string }).cliente_id === filtroCliente))
                  .map((s) => {
                    const clienteNome = (s as { clientes?: { nome: string } }).clientes?.nome;
                    return {
                      value: s.id,
                      label: s.nome,
                      ...(clienteNome ? { hint: clienteNome } : {}),
                    };
                  }),
                { value: "sem", label: "Sem servidor" },
              ]}
              placeholder="Servidor"
              searchPlaceholder="Pesquisar servidor..."
            />
          </div>
          <div className="sm:w-44">
            <ComboSelect
              value={filtroStatus}
              onChange={setFiltroStatus}
              options={[
                { value: "todos", label: "Todos os status" },
                { value: "online", label: "Online" },
                { value: "offline", label: "Offline" },
                { value: "indeterminado", label: "Indeterminado" },
                { value: "desativado", label: "Desativado" },
              ]}
              placeholder="Status"
            />
          </div>
          <div className="sm:w-52">
            <ComboSelect
              value={filtroInfo}
              onChange={setFiltroInfo}
              options={[
                { value: "todos", label: "Todas as informações" },
                { value: "ok", label: "Status OK" },
                { value: "hd", label: "HD com problema" },
                { value: "hora", label: "Hora incorreta" },
                { value: "sem_dados", label: "Sem informação" },
              ]}
              placeholder="Informação"
            />
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar DVR por nome, IP, fabricante ou servidor..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {selecionados.length > 0 && (
        <Card className="mb-4 border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              <span className="font-semibold">{selecionados.length}</span> DVR(s) selecionado(s)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setSelecionados([]); setUltimoIndice(null); }}>
                Limpar seleção
              </Button>
              {can("dvrs.editar") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reconectandoVarios}
                  onClick={() => reconectarVarios.mutate(selecionados)}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${reconectandoVarios ? "animate-spin" : ""}`} />
                  Renovar conexão
                </Button>
              )}
              {can("dvrs.excluir") && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={excluirVarios.isPending}
                  onClick={() => {
                    if (confirm(`Excluir ${selecionados.length} DVR(s) selecionado(s)?`))
                      excluirVarios.mutate(selecionados);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir selecionados
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={todosVisiveisSelecionados}
                    onCheckedChange={alternarTodos}
                    aria-label="Selecionar todos os DVRs da página"
                  />
                </TableHead>
                <SortHeader campo="nome" ordem={ordem} setOrdem={setOrdem}>DVR</SortHeader>
                <SortHeader campo="cliente" ordem={ordem} setOrdem={setOrdem}>Cliente</SortHeader>
                <SortHeader campo="servidor" ordem={ordem} setOrdem={setOrdem}>Servidor</SortHeader>
                <SortHeader campo="interno" ordem={ordem} setOrdem={setOrdem}>Interno</SortHeader>
                <TableHead>Externo</TableHead>
                <SortHeader campo="backup" ordem={ordem} setOrdem={setOrdem}>Backup</SortHeader>
                <TableHead>Gravando</TableHead>
                <SortHeader campo="status" ordem={ordem} setOrdem={setOrdem}>Status</SortHeader>
                <TableHead>Informação</TableHead>
                <TableHead className="text-left">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((d, i) => (
                <TableRow key={d.id} data-state={selecionados.includes(d.id) ? "selected" : undefined}>
                  <TableCell>
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        alternarLinha(i, e.shiftKey);
                      }}
                      className="inline-flex"
                    >
                      <Checkbox
                        checked={selecionados.includes(d.id)}
                        aria-label={`Selecionar ${d.nome}`}
                      />
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{d.nome}</p>
                    {(() => {
                      const info = d as { plataforma?: string | null };
                      const qtd = d.canais || 0;
                      const partes = [
                        d.fabricante,
                        d.modelo || info.plataforma || "",
                        qtd ? `${qtd} ${qtd === 1 ? "câmera" : "câmeras"}` : "",
                      ].filter(Boolean);
                      return (
                        <p className="text-xs text-muted-foreground truncate">
                          {partes.length ? partes.join(" · ") : "—"}
                        </p>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{(d as { clientes?: { nome: string } }).clientes?.nome ?? "—"}</TableCell>
                  <TableCell>{(d as { servidores?: { nome: string } }).servidores?.nome ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1">
                      <span>{d.ip_interno || "—"}{d.porta_http_interna ? `:${d.porta_http_interna}` : ""}</span>
                      {d.ip_interno && (
                        <a
                          href={`http://${d.ip_interno}${d.porta_http_interna ? `:${d.porta_http_interna}` : ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir página do equipamento (interno)"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1">
                      <span>{d.ip_externo || "—"}{d.porta_http_externa ? `:${d.porta_http_externa}` : ""}</span>
                      {d.ip_externo && (
                        <a
                          href={`http://${d.ip_externo}${d.porta_http_externa ? `:${d.porta_http_externa}` : ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir página do equipamento (externo)"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{d.dias_backup} dias</TableCell>
                  <TableCell>
                    {(() => {
                      const info = gravacaoDoDvr(d);
                      if (info.aviso)
                        return (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-default">
                                  {info.aviso}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[280px]">
                                <div className="space-y-1 text-xs">
                                  <p>Câmeras selecionadas: {info.selecionados.join(", ")}</p>
                                  <p>{info.idade}</p>
                                  {info.diagnosticoServidor ? (
                                    <p>{info.diagnosticoServidor}</p>
                                  ) : null}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      if (info.selecionados.length === 0)
                        return <span className="text-muted-foreground">—</span>;
                      return (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={info.gravando > 0 ? "default" : "secondary"}
                                className="cursor-default"
                              >
                                {info.gravando} / {info.selecionados.length}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[280px]">
                              <div className="space-y-1 text-xs">
                                <p>Câmeras selecionadas: {info.selecionados.join(", ")}</p>
                                <p>{info.idade}</p>
                                {info.detalhes.length > 0 ? (
                                  info.detalhes.map((t) => <p key={t}>{t}</p>)
                                ) : (
                                  <p>Sem retorno do servidor para estas câmeras.</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })()}
                  </TableCell>

                  <TableCell>
                    {(() => {
                      const st = statusDoDvr(d as Parameters<typeof statusDoDvr>[0]);
                      return (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={st.variante} className="cursor-default">
                                {st.rotulo}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <div className="space-y-1 text-xs">
                                {st.detalhes.map((t) => (
                                  <p key={t}>{t}</p>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <InformacaoDvr
                      dvr={d as unknown as Parameters<typeof InformacaoDvr>[0]["dvr"]}
                      podeAjustar={can("dvrs.editar")}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-start gap-1">
                      {can("dvrs.editar") && (
                        <Switch
                          checked={d.ativo}
                          onCheckedChange={(ativo) => alternarAtivo.mutate({ id: d.id, ativo })}
                          title={d.ativo ? "Desativar DVR" : "Ativar DVR"}
                          aria-label={d.ativo ? `Desativar ${d.nome}` : `Ativar ${d.nome}`}
                        />
                      )}
                      {can("dvrs.editar") && (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={reconectando === d.id}
                                onClick={() => reconectar.mutate(d.id)}
                                aria-label={`Renovar conexão de ${d.nome}`}
                              >
                                <RefreshCw
                                  className={cn("h-4 w-4", reconectando === d.id && "animate-spin")}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Renovar conexão com o servidor</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {can("dvrs.editar") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setForm({
                            id: d.id,
                            cliente_id: d.cliente_id,
                            servidor_id: d.servidor_id ?? "",
                            nome: d.nome,
                            fabricante: d.fabricante ?? "",
                            modelo: d.modelo ?? "",
                            canais: d.canais,
                            canais_gravacao: d.canais_gravacao ?? [],
                            gravar_todos_canais:
                              (d as { gravar_todos_canais?: boolean | null }).gravar_todos_canais === true,
                            usuario: d.usuario ?? "",
                            senha: d.senha ?? "",
                            ip_interno: d.ip_interno ?? "",
                            porta_http_interna: d.porta_http_interna?.toString() ?? "",
                            porta_rtsp_interna: d.porta_rtsp_interna?.toString() ?? "",
                            porta_servico_interna: d.porta_servico_interna?.toString() ?? "",
                            ip_externo: d.ip_externo ?? "",
                            porta_http_externa: d.porta_http_externa?.toString() ?? "",
                            porta_rtsp_externa: d.porta_rtsp_externa?.toString() ?? "",
                            porta_servico_externa: d.porta_servico_externa?.toString() ?? "",
                             cloud: d.cloud ?? "",
                             porta_cloud: d.porta_cloud?.toString() ?? "",
                             porta_http_cloud: (d as { porta_http_cloud?: number | null }).porta_http_cloud?.toString() ?? "",
                             prioridade_conexao:
                              (d as { prioridade_conexao?: string[] | null }).prioridade_conexao?.length
                                ? (d as { prioridade_conexao: string[] }).prioridade_conexao
                                : ["interno", "externo", "cloud"],
                            observacao: d.observacao ?? "",
                            dias_backup: d.dias_backup,
                            ativo: d.ativo,
                            perfil_minimo: d.perfil_minimo ?? "visualizador",
                            perfis_base: ((d as { perfis_base?: string[] }).perfis_base ?? ["visualizador", "operador", "admin", "master"]) as ("visualizador" | "operador" | "admin" | "master")[],
                            perfis_ids: d.perfis_ids ?? [],
                            fuso_horario: (d as { fuso_horario?: string | null }).fuso_horario || FUSO_PADRAO,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {can("dvrs.excluir") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Excluir o DVR ${d.nome}?`)) excluir.mutate(d.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum DVR cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="DVRs" />
        </CardContent>
      </Card>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-7">
              <DialogTitle>{form.id ? "Editar DVR" : "Novo DVR"}</DialogTitle>
              <AjudaJanela rota="/dvrs/novo-dvr" titulo="Cadastrar DVR" aberto={aberto} />
            </div>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-3" data-ajuda="dvr-dados-principais">
            <div className="space-y-2" data-ajuda="dvr-cliente">
              <Label>Cliente</Label>
              <ComboSelect
                value={form.cliente_id}
                onChange={(v) => setForm({ ...form, cliente_id: v, servidor_id: "" })}
                options={(clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar cliente..."
              />
            </div>
            <div className="space-y-2" data-ajuda="dvr-servidor">
              <Label>Servidor</Label>
              <ComboSelect
                value={form.servidor_id}
                onChange={(v) => setForm({ ...form, servidor_id: v })}
                disabled={!form.cliente_id}
                options={servidoresDoCliente.map((s) => ({ value: s.id, label: s.nome }))}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar servidor..."
              />

            </div>
            {campo("Nome", "nome")}
            <div className="space-y-2">
              <Label>Fabricante *</Label>
              <ComboSelect
                value={form.fabricante}
                onChange={(v) => setForm({ ...form, fabricante: v })}
                options={[
                  ...(fabricantes.data ?? []).map((f) => ({ value: f.nome, label: f.nome })),
                  ...(form.fabricante && !(fabricantes.data ?? []).some((f) => f.nome === form.fabricante)
                    ? [{ value: form.fabricante, label: form.fabricante }]
                    : []),
                ]}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar fabricante..."
                emptyText="Cadastre em Administração › Fabricantes."
              />
            </div>
            {campo("Modelo", "modelo")}
            <div className="space-y-2" data-ajuda="dvr-quantidade-cameras">
              <Label>Quantidade de câmeras</Label>
              <Input
                type="number"
                min={0}
                max={128}
                value={form.canais}
                onChange={(e) => {
                  const qtd = Math.max(0, Math.min(128, Number(e.target.value) || 0));
                  setForm({
                    ...form,
                    canais: qtd,
                    canais_gravacao: form.canais_gravacao.filter((c) => c <= qtd),
                  });
                }}
              />
            </div>
            {campo("Usuário", "usuario")}
            <div className="space-y-2" data-ajuda="dvr-senha">
              <Label>Senha</Label>
              <div className="relative">
                <Input
                  type={verSenha ? "text" : "password"}
                  className="pr-10"
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                  title={verSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {campo("Tempo de backup (dias)", "dias_backup", "number")}
            <div className="space-y-2" data-ajuda="dvr-fuso-horario">
              <div className="flex items-center gap-1.5">
                <Label>Fuso horário</Label>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" aria-label="Sobre o fuso horário" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Ao salvar, o servidor local acerta o relógio do DVR neste fuso (horário oficial do NTP.br).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ComboSelect
                value={form.fuso_horario}
                onChange={(v) => setForm({ ...form, fuso_horario: v })}
                options={FUSOS_BRASIL.map((f) => ({ value: f.value, label: f.label }))}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar fuso..."
              />
            </div>
            <div className="space-y-2" data-ajuda="dvr-perfis-visiveis">
              <Label>Perfis que podem ver</Label>
              <ComboMultiSelect
                values={perfisSelecionados}
                onChange={(vals) => {
                  const ids = vals.filter((v) => v.startsWith("perfil:")).map((v) => v.slice(7));
                  const papeis = vals.filter((v) => !v.startsWith("perfil:")) as ("visualizador" | "operador" | "admin" | "master")[];
                  const minimo =
                    papeis.length > 0
                      ? (ORDEM_PERFIS.find((p) => papeis.includes(p as "visualizador" | "operador" | "admin" | "master") ?? "visualizador") as string)
                      : "visualizador";
                  setForm({ ...form, perfis_ids: ids, perfis_base: papeis, perfil_minimo: minimo });
                }}
                options={opcoesPerfilVisao}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar perfil..."
              />
            </div>

          </div>

          {form.canais > 0 && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Câmeras gravadas (
                  {form.gravar_todos_canais ? form.canais : form.canais_gravacao.length}/
                  {form.canais})
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.gravar_todos_canais}
                      onCheckedChange={(v) => setForm({ ...form, gravar_todos_canais: v })}
                      aria-label="Gravar todas as câmeras"
                    />
                    <span className="text-xs text-muted-foreground">Gravar todas</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={form.gravar_todos_canais}
                    onClick={() =>
                      setForm({ ...form, canais_gravacao: [], gravar_todos_canais: false })
                    }
                  >
                    Nenhuma
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: form.canais }, (_, i) => i + 1).map((n) => {
                  const sel = form.gravar_todos_canais || form.canais_gravacao.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={sel}
                      disabled={form.gravar_todos_canais}
                      onClick={() =>
                        setForm({
                          ...form,
                          canais_gravacao: sel
                            ? form.canais_gravacao.filter((c) => c !== n)
                            : [...form.canais_gravacao, n].sort((a, b) => a - b),
                        })
                      }
                      className={cn(
                        "flex h-10 w-12 items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                        sel
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                        form.gravar_todos_canais && "opacity-70",
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Clique nas câmeras para selecionar. Somente as selecionadas serão gravadas. Sem
                nenhuma selecionada, este equipamento não grava.
              </p>
            </div>
          )}


          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Arraste os blocos para definir a ordem de prioridade da conexão (1, 2 e 3).
            </p>
            {form.prioridade_conexao.map((origem, indice) => (
              <div
                key={origem}
                draggable
                onDragStart={() => setArrastando(origem)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!arrastando || arrastando === origem) return;
                  const nova = form.prioridade_conexao.filter((o) => o !== arrastando);
                  nova.splice(nova.indexOf(origem), 0, arrastando);
                  setForm({ ...form, prioridade_conexao: nova });
                  setArrastando(null);
                }}
                onDragEnd={() => setArrastando(null)}
                className={cn(
                  "cursor-grab rounded-lg border bg-muted/20 p-3 active:cursor-grabbing",
                  arrastando === origem && "opacity-60",
                )}
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                  Prioridade {indice + 1}
                </div>
                {origem === "interno" && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {campo("IP INTERNO", "ip_interno")}
                    {campo("HTTP", "porta_http_interna")}
                    {campo("RTSP", "porta_rtsp_interna")}
                    {campo("Serviço", "porta_servico_interna")}
                  </div>
                )}
                {origem === "externo" && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {campo("IP EXTERNO", "ip_externo")}
                    {campo("HTTP", "porta_http_externa")}
                    {campo("RTSP", "porta_rtsp_externa")}
                    {campo("Serviço", "porta_servico_externa")}
                  </div>
                )}
                {origem === "cloud" && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="sm:col-span-2">{campo("Cloud", "cloud")}</div>
                    {campo("HTTP", "porta_http_cloud")}
                    {campo("Serviço", "porta_cloud")}
                  </div>
                )}
              </div>
            ))}
          </div>


          <div className="mt-2 space-y-2" data-ajuda="dvr-observacao">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Observação
          </p>
          <Textarea
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            placeholder="Observações sobre o DVR..."
            rows={1}
            className="resize-none overflow-hidden min-h-[40px]"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          </div>

          <DialogFooter>
            {form.id && can("dvrs.criar") && (
              <Button
                type="button"
                variant="secondary"
                className="mr-auto"
                onClick={() => {
                  const { id, ...resto } = form;
                  void id;
                  setForm({ ...resto, nome: `${form.nome} (cópia)` });
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Clonar
              </Button>
            )}
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              data-ajuda="dvr-salvar"
              onClick={() => salvar.mutate(form)}
              disabled={!form.nome || !form.cliente_id || salvar.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
