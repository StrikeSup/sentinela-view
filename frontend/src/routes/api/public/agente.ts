import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mosaicoAutomatico } from "@/lib/mosaicos";
import {
  resolverCamerasDeteccao,
  type CameraDeteccaoAtiva,
  type LinhaCameraDeteccao,
} from "@/lib/agente-deteccao";
import type { Json } from "@/integrations/supabase/types";

// Endpoint usado pelos servidores (agentes de imagem) para:
// - GET  ?licenca=XXX  (header x-agente-token) -> devolve os DVRs que o servidor deve subir
// - POST { licenca, versao?, uptime?, disco?, dvrs: [...] } (header x-agente-token) -> sinal de vida + status
const postSchema = z.object({
  licenca: z.string().min(4).max(200),
  versao: z.string().max(60).optional(),
  uptime_segundos: z.number().int().nonnegative().max(9_000_000_000).optional(),
  disco_percentual: z.number().min(0).max(100).optional(),
  // métricas leves do agente (1.0.53+); agentes antigos não enviam
  metricas_agent: z
    .object({
      cpu_percent: z.number().min(0).max(1000).optional(),
      memory_mb: z.number().min(0).optional(),
      hot_streams: z.number().int().min(0).optional(),
      warm_streams: z.number().int().min(0).optional(),
      cold_cameras: z.number().int().min(0).optional(),
      active_viewers: z.number().int().min(0).optional(),
      transcodes: z.number().int().min(0).optional(),
      profile: z.string().max(40).optional(),
    })
    .passthrough()
    .optional(),
  dvrs: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        nome: z.string().max(200).optional(),
        ip: z.string().max(100).optional(),
        online: z.union([z.boolean(), z.string(), z.number()]).optional(),
        status: z.union([z.boolean(), z.string(), z.number()]).optional(),
        conectado: z.union([z.boolean(), z.string(), z.number()]).optional(),
        detalhe: z.string().max(500).optional(),
        // dados detectados pelo servidor (todos opcionais).
        // O agente envia os mesmos valores em português e inglês; guardamos um nome só.
        fabricante: z.string().max(120).optional(),
        manufacturer: z.string().max(120).optional(),
        marca: z.string().max(120).optional(),
        brand: z.string().max(120).optional(),
        manufacturer_oem: z.string().max(120).optional(),
        modelo: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        plataforma: z.string().max(120).optional(),
        platform: z.string().max(120).optional(),
        driver: z.string().max(120).optional(),
        detection_confidence: z.union([z.number(), z.string().max(20)]).optional(),
        quantidade_cameras: z.union([z.number(), z.string().max(10)]).optional(),
        camera_count: z.union([z.number(), z.string().max(10)]).optional(),
        canais: z.union([z.number(), z.string().max(10)]).optional(),
        channels: z.union([z.number(), z.string().max(10)]).optional(),
        ip_interno: z.string().max(100).optional(),
        porta_http_interna: z.number().int().min(1).max(65535).optional(),
        porta_rtsp_interna: z.number().int().min(1).max(65535).optional(),
        porta_servico_interna: z.number().int().min(1).max(65535).optional(),
        firmware: z.string().max(120).optional(),
        serial: z.string().max(120).optional(),
        serie: z.string().max(120).optional(),
        serial_number: z.string().max(120).optional(),
        onvif: z.boolean().optional(),
        // alpha 54: conectividade atual sondada pelo Agent
        status_atualizado_em: z.string().max(60).nullish(),
        ultimo_sinal_em: z.string().max(60).nullish(),
        status_motivo: z.string().max(500).nullish(),
        status_origem: z.string().max(40).nullish(),
        rtsp: z.string().max(40).nullish(),
        http: z.string().max(40).nullish(),
        video: z.string().max(40).nullish(),
        // Agent v43: telemetria de HD e relógio (null preservado)
        status_hd: z.string().max(500).nullish(),
        data_hora_dvr: z.string().max(40).nullish(),
        dados_dvr_atualizados_em: z.string().max(60).nullish(),
      }),
    )
    .max(500)
    .default([]),
  // alpha 54: saúde/conectividade por DVR, enviada mesmo durante a descoberta
  // inicial (quando `dvrs` pode vir vazio para não apagar metadados).
  saude_dvrs: z
    .array(
      z
        .object({
          dvr_id: z.string().uuid().optional(),
          id: z.string().uuid().optional(),
          online: z.union([z.boolean(), z.string(), z.number()]).nullish(),
          status: z.union([z.boolean(), z.string(), z.number()]).nullish(),
          status_atualizado_em: z.string().max(60).nullish(),
          ultimo_sinal_em: z.string().max(60).nullish(),
          status_motivo: z.string().max(500).nullish(),
          status_origem: z.string().max(40).nullish(),
          rtsp: z.string().max(40).nullish(),
          http: z.string().max(40).nullish(),
          video: z.string().max(40).nullish(),
        })
        .passthrough(),
    )
    .max(500)
    .nullish(),
  // catálogo de mídia enviado pelo servidor (gateway local + câmeras)
  midia: z
    .object({
      modo: z.string().max(60).optional(),
      hls_base_url: z.string().max(500).optional(),
      auth_scheme: z.string().max(60).optional(),
      gateway_local_online: z.boolean().optional(),
      gateway_online: z.boolean().optional(),
      // capacidade de vídeo direto (WebRTC) anunciada pelo servidor local
      webrtc: z
        .object({
          disponivel: z.boolean().optional(),
          sinalizacao: z.string().max(60).optional(),
          host_publico: z.string().max(200).optional(),
          porta_udp: z.number().int().min(1).max(65535).optional(),
          transporte: z.string().max(20).optional(),
          credenciais_dvr_expostas: z.boolean().optional(),
        })
        .passthrough()
        .optional(),
      cameras: z
        .array(
          z.object({
            dvr_id: z.string().uuid().optional(),
            canal: z.number().int().min(1).max(512).optional(),
            nome: z.string().max(200).optional(),
            online: z.union([z.boolean(), z.string(), z.number()]).optional(),
            path: z.string().max(300).optional(),
          }),
        )
        .max(5000)
        .default([]),
    })
    .passthrough()
    .optional(),
  // catálogo de gravações locais (nunca contém caminhos nem credenciais).
  // Itens são validados um a um para que um registro ruim não descarte a coleção.
  arquivos_gravados: z.array(z.unknown()).max(5000).optional(),
  catalogo_gravacoes: z
    .object({
      versao: z.number().int().min(0).optional(),
      total: z.number().int().min(0).optional(),
      gerado_em: z.string().max(60).optional(),
      consulta_fila_segundos: z.number().min(0).max(3600).optional(),
      download_range: z.boolean().optional(),
    })
    .passthrough()
    .optional(),

  // Estado da gravação local (Agent Next alpha 33). Campos ausentes = Agent antigo.
  gravacao: z
    .object({
      origem: z.string().max(40).nullish(),
      habilitada: z.boolean().nullish(),
      pausada_localmente: z.boolean().nullish(),
      disco_configurado: z.boolean().nullish(),
      diagnostico: z.string().max(500).nullish(),
      dvrs_solicitados: z.array(z.string()).max(500).nullish(),
      canais_gravando: z.coerce.number().int().min(0).max(100000).nullish(),
    })
    .passthrough()
    .nullish(),
  // Discos do servidor local. Nunca inclui caminho interno além do ponto de montagem.
  // Todos os campos além do id aceitam nulo: Agent pode não conseguir ler algum dado.
  discos: z
    .array(
      z
        .object({
          id: z.string().min(1).max(200),
          rotulo: z.string().max(200).nullish(),
          ponto_montagem: z.string().max(300).nullish(),
          sistema_arquivos: z.string().max(60).nullish(),
          total_bytes: z.coerce.number().min(0).max(9e18).nullish(),
          usado_bytes: z.coerce.number().min(0).max(9e18).nullish(),
          livre_bytes: z.coerce.number().min(0).max(9e18).nullish(),
          gravando: z.boolean().nullish(),
          somente_leitura: z.boolean().nullish(),
          removivel: z.boolean().nullish(),
          saudavel: z.boolean().nullish(),
          diagnostico: z.string().max(500).nullish(),
        })
        .passthrough(),
    )
    .max(64)
    .nullish(),
  gravacoes: z
    .array(
      z
        .object({
          dvr_id: z.string().uuid(),
          canal: z.coerce.number().int().min(1).max(512),
          estado: z
            .enum(["conectando", "aguardando_video", "gravando", "reconectando", "pausada", "erro"])
            .catch("conectando"),
          qualidade: z.string().max(40).nullish(),
          atualizado_em: z.string().max(60).nullish(),
          diagnostico: z.string().max(500).nullish(),
          // alpha 46: em qual volume aquele canal está gravando (opcional)
          disco_id: z.string().max(200).nullish(),
        })
        .passthrough(),
    )
    .max(5000)
    .nullish(),
  // alpha 47: associação efetiva/salva de cada DVR a um volume. Telemetria:
  // nunca comanda migração. Ausente = Agent antigo, vínculos preservados.
  distribuicao_discos: z
    .array(
      z
        .object({
          dvr_id: z.string().uuid(),
          disco_id: z.string().min(1).max(200),
          disco_disponivel: z.boolean().nullish(),
          vinculo_fixo: z.boolean().nullish(),
          estado: z
            .enum(["gravando", "aguardando_video", "pausado", "vinculado", "disco_indisponivel"])
            .catch("vinculado"),
          canais_gravando: z.coerce.number().int().min(0).max(100000).nullish(),
        })
        .passthrough(),
    )
    .max(1000)
    .nullish(),
});

const arquivoSchema = z.object({
  // SHA-256 hexadecimal de 64 caracteres: texto, nunca UUID
  id: z.string().min(4).max(200),
  dvr_id: z.string().uuid().optional(),
  dvr_nome: z.string().max(200).optional(),
  canal: z.number().int().min(1).max(512).optional(),
  camera_nome: z.string().max(200).optional(),
  inicio: z.string().max(60),
  fim: z.string().max(60).optional(),
  duracao_segundos: z.number().int().min(0).max(10_000_000).optional(),
  tamanho_bytes: z.number().int().min(0).max(9_000_000_000_000).optional(),
  disponivel: z.boolean().optional(),
  formato: z.string().max(60).optional(),
  // Reprodução por download parcial (Range). A URL é opaca: guardada como veio.
  inicio_epoch_ms: z.number().int().min(0).optional(),
  fuso_horario: z.string().max(120).optional(),
  download_url: z.string().url().max(2000).optional(),
  download_range: z.boolean().optional(),
});

/** Deriva dvr_id e canal do caminho `<uuid>_ch_001` quando o agente não os envia. */
function doPath(path: string | undefined): { dvr_id: string; canal: number } | null {
  if (!path) return null;
  const m = /^([0-9a-fA-F-]{36})_ch_(\d+)$/.exec(path.trim());
  if (!m) return null;
  const canal = Number(m[2]);
  if (!Number.isFinite(canal) || canal < 1) return null;
  return { dvr_id: m[1]!.toLowerCase(), canal };
}

function normalizarOnline(valor: boolean | string | number | undefined): boolean | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor > 0;
  const v = valor.trim().toLowerCase();
  if (["true", "1", "online", "on", "up", "ok", "conectado", "ativo", "sim"].includes(v))
    return true;
  if (["false", "0", "offline", "off", "down", "desconectado", "inativo", "nao", "não"].includes(v))
    return false;
  return undefined;
}

type EstadoDvr = "online" | "offline" | "indeterminado";

type SaudeDvr = {
  dvr_id: string;
  status: EstadoDvr;
  status_atualizado_em?: string | null;
  ultimo_sinal_em?: string | null;
  status_motivo?: string | null;
  status_origem?: string | null;
  rtsp?: string | null;
  http?: string | null;
  video?: string | null;
};

/** "indeterminado" nunca vira offline: é uma verificação ainda pendente. */
function normalizarEstado(
  valor: boolean | string | number | null | undefined,
): EstadoDvr | undefined {
  if (valor === undefined || valor === null) return undefined;
  const t = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (["indeterminado", "unknown", "desconhecido", "pendente", "verificando"].includes(t))
    return "indeterminado";
  const b = normalizarOnline(valor);
  return b === undefined ? undefined : b ? "online" : "offline";
}

/** Monta a saúde de um DVR a partir do heartbeat (forma simples ou enriquecida). */
function saudeDoItem(
  id: string | undefined,
  o: {
    online?: boolean | string | number | null | undefined;
    status?: boolean | string | number | null | undefined;
    conectado?: boolean | string | number | null | undefined;
    status_atualizado_em?: string | null | undefined;
    ultimo_sinal_em?: string | null | undefined;
    status_motivo?: string | null | undefined;
    status_origem?: string | null | undefined;
    rtsp?: string | null | undefined;
    http?: string | null | undefined;
    video?: string | null | undefined;
  },
): SaudeDvr | null {
  if (!id) return null;
  const status =
    normalizarEstado(o.status ?? undefined) ??
    normalizarEstado(o.online ?? undefined) ??
    normalizarEstado(o.conectado ?? undefined);
  if (!status) return null;
  return {
    dvr_id: id.toLowerCase(),
    status,
    status_atualizado_em: o.status_atualizado_em ?? null,
    ultimo_sinal_em: o.ultimo_sinal_em ?? null,
    status_motivo: o.status_motivo ?? null,
    status_origem: o.status_origem ?? null,
    rtsp: o.rtsp ?? null,
    http: o.http ?? null,
    video: o.video ?? null,
  };
}

/** Primeiro valor de texto realmente preenchido. */
function texto(...valores: (string | undefined)[]): string | undefined {
  for (const v of valores) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) return t;
  }
  return undefined;
}

/** Número positivo; zero ou lixo viram indefinido (não sobrescreve o cadastro). */
function positivo(...valores: (number | string | undefined)[]): number | undefined {
  for (const v of valores) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 512) return Math.trunc(n);
  }
  return undefined;
}

function decimal(valor: number | string | undefined): number | undefined {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Motorola é vendida com a plataforma TVT/NVMS-9000: mostramos sempre "Motorola". */
function marcaCanonica(nome: string | undefined): string | undefined {
  if (!nome) return undefined;
  const n = nome.trim().toLowerCase();
  if (n.includes("motorola") || n === "tvt" || n.includes("tvt ") || n.includes("nvms"))
    return "Motorola";
  return nome.trim();
}

function token(request: Request) {
  return (
    request.headers.get("x-agente-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

export const Route = createFileRoute("/api/public/agente")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const licenca = new URL(request.url).searchParams.get("licenca") ?? "";
        const chave = token(request);
        if (!licenca || !chave)
          return new Response("Licença e chave obrigatórias", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: servidor } = await supabaseAdmin
          .from("servidores")
          // "*" para trazer também as colunas novas (discos_gravacao, gravar_todos_discos)
          // que ainda não constam no arquivo de tipos gerado.
          .select("*, clientes:cliente_id (id, nome)")
          .eq("licenca", licenca)
          .eq("token", chave)
          .eq("ativo", true)
          .maybeSingle();
        if (!servidor) return new Response("Licença ou chave inválida", { status: 401 });

        const { data: dvrs } = await supabaseAdmin
          .from("dvrs")
          .select(
            "id, nome, fabricante, modelo, canais, canais_gravacao, gravar_todos_canais, usuario, senha, ip_interno, porta_http_interna, porta_rtsp_interna, porta_servico_interna, ip_externo, porta_http_externa, porta_rtsp_externa, porta_servico_externa, cloud, porta_http_cloud, porta_cloud, dias_backup, ativo",
          )
          .eq("servidor_id", servidor.id)
          .eq("ativo", true);

        await supabaseAdmin
          .from("servidores")
          .update({ online: true, ultimo_contato: new Date().toISOString() })
          .eq("id", servidor.id);

        const cli = (servidor as unknown as { clientes: { id: string; nome: string } | null })
          .clientes;
        // Contrato de gravação: a seleção do frontend é sempre explícita.
        // canais_gravacao vazio = não gravar; gravar_todos_canais = capacidade confirmada.
        type DvrConfig = Record<string, unknown> & {
          id?: string;
          canais?: number | null;
          canais_gravacao?: number[] | null;
          gravar_todos_canais?: boolean | null;
        };
        const lista = ((dvrs ?? []) as unknown as DvrConfig[]).map((d) => {
          const canais = Math.max(0, Number(d.canais) || 0);
          // "Gravar todas" só vale com capacidade confirmada (> 0).
          const todos = d.gravar_todos_canais === true && canais > 0;

          const selecao = Array.isArray(d.canais_gravacao)
            ? [...new Set(d.canais_gravacao.filter((c) => Number.isFinite(c) && c >= 1))].sort(
                (a, b) => a - b,
              )
            : [];
          return {
            ...d,
            quantidade_cameras: canais,
            gravar_todos_canais: todos,
            canais_gravacao: todos
              ? Array.from({ length: canais }, (_, i) => i + 1)
              : selecao.filter((c) => !canais || c <= canais),
          };
        });
        // Escolha de discos feita no Sentinela. Lista vazia e "todos" desligado
        // = nada escolhido aqui, o Agent mantém a configuração local dele.
        const conf = servidor as unknown as {
          discos_gravacao?: unknown;
          gravar_todos_discos?: boolean | null;
        };
        const discosGravacao = Array.isArray(conf.discos_gravacao)
          ? [
              ...new Set(
                conf.discos_gravacao.filter(
                  (d): d is string => typeof d === "string" && d.length > 0,
                ),
              ),
            ]
          : [];

        // Lista de trabalho para análise de quadros no Agent: somente câmeras
        // com detecção explicitamente ativada, restritas aos DVRs ativos
        // atribuídos a este servidor. Lista vazia explícita quando nada ativo.
        const dvrIds = lista
          .map((d) => (typeof d.id === "string" ? d.id : null))
          .filter((id): id is string => id !== null);
        let camerasDeteccaoAtivas: CameraDeteccaoAtiva[] = [];
        if (dvrIds.length > 0) {
          const { data: deteccao, error: erroDeteccao } = await supabaseAdmin
            .from("cameras_deteccao" as never)
            .select("dvr_id, canal, colunas, linhas, sensibilidade, ignorados")
            .in("dvr_id", dvrIds)
            .eq("ativo", true);
          // Falha na consulta não é "nada ativo": virar lista vazia faria o
          // Agent parar todas as análises em erro transitório. Respondemos
          // 503 para o Agent preservar a última configuração e tentar depois.
          if (erroDeteccao) {
            return new Response(JSON.stringify({ erro: "Serviço temporariamente indisponível" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          }
          const resultado = resolverCamerasDeteccao(dvrIds, {
            erro: false,
            linhas: (deteccao ?? []) as unknown as LinhaCameraDeteccao[],
          });
          if (resultado.ok) camerasDeteccaoAtivas = resultado.cameras;
        }
        // Layouts abertos têm prioridade; pedidos antigos por DVR continuam compatíveis.
        // Sempre entregar canais como lista: o Agent não interpreta uma contagem numérica.
        const { montarPreconexao } = await import("@/lib/preparacao-layout");
        let dvrsPreconectar: ReturnType<typeof montarPreconexao> = [];
        if (dvrIds.length > 0) {
          const agora = new Date();
          const { data: camerasLayout } = await supabaseAdmin
            .from("preparo_layout" as never)
            .select("dvr_id,canal,expira_em")
            .in("dvr_id", dvrIds)
            .gt("expira_em", agora.toISOString())
            .order("expira_em", { ascending: false })
            .limit(1024);
          const { data: pre, error: erroPre } = await supabaseAdmin
            .from("dvrs")
            .select("id, canais, preconectar_ate" as never)
            .in("id", dvrIds)
            .gt("preconectar_ate" as never, agora.toISOString() as never);
          dvrsPreconectar = montarPreconexao(
            erroPre ? [] : ((pre ?? []) as unknown as {
              id: string;
              canais: number | null;
              preconectar_ate: string;
            }[]),
            (camerasLayout ?? []) as unknown as { dvr_id: string; canal: number; expira_em: string }[],
            agora,
          );
        }
        // Câmeras com detecção ativa ficam SEMPRE pré-conectadas: o Agent mantém o
        // RTSP delas aberto (renovado a cada consulta) para o vídeo abrir na hora.
        const camerasPreconectar = camerasDeteccaoAtivas.map((c) => ({
          dvr_id: c.dvr_id,
          canal: c.canal,
          ate: new Date(Date.now() + 2 * 60_000).toISOString(),
        }));
        // Portão aberto: câmeras calibradas e ativas. Erro = lista ausente (Agent mantém a anterior).
        let camerasPortaoAtivas: unknown[] | undefined = [];
        if (dvrIds.length > 0) {
          const { data: portoes, error: erroPortao } = await supabaseAdmin
            .from("cameras_portao" as never)
            .select("dvr_id, canal, roi, sensibilidade, tolerancia_segundos, referencias_fechado, referencias_aberto, modo_calibracao, referencias_fechado_noite, referencias_aberto_noite, opcoes_avancadas, atualizado_em")
            .in("dvr_id", dvrIds)
            .eq("ativo", true);
          const { opcoesEfetivas } = await import("@/lib/portao-processamento");
          // Modo avançado: referencias_* levam dia + noite juntas (Agent antigo continua funcionando);
          // as listas separadas seguem em *_dia / *_noite para quem quiser escolher pelo horário.
          type LinhaPortao = Record<string, unknown> & {
            modo_calibracao?: string | null;
            referencias_fechado?: string[] | null;
            referencias_aberto?: string[] | null;
            referencias_fechado_noite?: string[] | null;
            referencias_aberto_noite?: string[] | null;
            opcoes_avancadas?: Record<string, boolean> | null;
          };
          camerasPortaoAtivas = erroPortao
            ? undefined
            : ((portoes ?? []) as unknown as LinhaPortao[]).map((p) => {
                const fd = p.referencias_fechado ?? [];
                const ad = p.referencias_aberto ?? [];
                const opcoes = opcoesEfetivas(p.modo_calibracao === "avancado", p.opcoes_avancadas);
                if (p.modo_calibracao !== "avancado") {
                  const { referencias_fechado_noite: _f, referencias_aberto_noite: _a, ...resto } = p;
                  return { ...resto, modo_calibracao: "padrao", opcoes_avancadas: opcoes };
                }
                const fn = p.referencias_fechado_noite ?? [];
                const an = p.referencias_aberto_noite ?? [];
                return {
                  ...p,
                  opcoes_avancadas: opcoes,
                  referencias_fechado: [...fd, ...fn],
                  referencias_aberto: [...ad, ...an],
                  referencias_fechado_dia: fd,
                  referencias_aberto_dia: ad,
                };
              });
        }
        const { snapshotsSolicitados } = await import("@/lib/snapshot-cache.server");
        // Ajustes de horário pedidos pelo operador (Agent v45). Só DVRs desta licença.
        let ajustesHorario: { id: string; dvr_id: string; expira_em: string; fuso_horario: string; horario_manual?: string }[] = [];
        {
          const { PRAZO_AGENT_MS, PRAZO_ENTREGA_MS } = await import("@/lib/ajuste-horario");
          const db = supabaseAdmin as unknown as { from: (t: string) => any };
          const agora = Date.now();
          const agoraIso = new Date(agora).toISOString();
          await db.from("dvr_ajustes_horario").update({ estado: "expirado" }).eq("estado", "pendente").lt("expira_em", agoraIso);
          await db
            .from("dvr_ajustes_horario")
            .update({ estado: "expirado" })
            .eq("estado", "pendente")
            .is("expira_em", null)
            .lt("criado_em", new Date(agora - PRAZO_ENTREGA_MS).toISOString());
          const ids = lista.map((d) => d.id).filter(Boolean) as string[];
          if (ids.length > 0) {
            const { data: pend } = await db
              .from("dvr_ajustes_horario")
              .select("id, dvr_id, expira_em, fuso_horario, horario_manual")
              .eq("estado", "pendente")
              .in("dvr_id", ids);
            const novos = ((pend ?? []) as { id: string; expira_em: string | null }[])
              .filter((x) => !x.expira_em)
              .map((x) => x.id);
            const prazo = new Date(agora + PRAZO_AGENT_MS).toISOString();
            if (novos.length > 0)
              await db.from("dvr_ajustes_horario").update({ expira_em: prazo }).in("id", novos).is("expira_em", null);
            ajustesHorario = ((pend ?? []) as (typeof ajustesHorario[number] & { horario_manual: string | null })[]).map(
              ({ horario_manual, ...x }) => ({
                ...x,
                expira_em: x.expira_em ?? prazo,
                ...(horario_manual ? { horario_manual } : {}),
              }),
            );
          }
        }
        return Response.json({
          ajustes_horario_solicitados: ajustesHorario,
          snapshots_solicitados: snapshotsSolicitados(dvrIds),
          cameras_deteccao_ativas: camerasDeteccaoAtivas,
          ...(camerasPortaoAtivas ? { cameras_portao_ativas: camerasPortaoAtivas } : {}),
          dvrs_preconectar: dvrsPreconectar,
          cameras_preconectar: camerasPreconectar,
          ok: true,
          servidor: {
            id: servidor.id,
            nome: servidor.nome,
            cliente_id: servidor.cliente_id,
            config_atualizada_em: servidor.config_atualizada_em,
          },
          discos_gravacao: discosGravacao,
          gravar_todos_discos: conf.gravar_todos_discos === true,
          cliente: { id: cli?.id ?? servidor.cliente_id, nome: cli?.nome ?? "" },
          dvrs: lista,
          devices: lista,
          total: lista.length,
        });
      },

      POST: async ({ request }) => {
        const chave = token(request);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }
        const parsed = postSchema.safeParse(body);
        if (!parsed.success) {
          // Devolve qual campo falhou (caminho + motivo), nunca o valor enviado,
          // para não registrar usuário, senha ou token em log.
          const campos = parsed.error.issues.slice(0, 20).map((i) => ({
            campo: i.path.join(".") || "(raiz)",
            erro: i.message,
          }));
          return new Response(JSON.stringify({ erro: "Dados inválidos", campos }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (!chave) return new Response("Chave obrigatória", { status: 401 });
        const p = parsed.data;

        // Um nome canônico por informação; aliases em inglês só entram como alternativa.
        // Nunca enviamos usuário, senha ou token junto destes metadados.
        const dvrs = p.dvrs.map((d) => {
          const bruto = d.online ?? d.status ?? d.conectado;
          const fabricante = marcaCanonica(
            texto(d.fabricante, d.manufacturer, d.marca, d.brand, d.manufacturer_oem),
          );
          const modelo = texto(d.modelo, d.model);
          const plataformaBruta = texto(d.plataforma, d.platform);
          const plataforma =
            plataformaBruta ?? (fabricante === "Motorola" && !modelo ? "NVMS-9000" : undefined);
          const serial = texto(d.serial, d.serie, d.serial_number);
          const quantidade = positivo(d.quantidade_cameras, d.camera_count, d.canais, d.channels);
          const driver = texto(d.driver);
          const confianca = decimal(d.detection_confidence);
          const detectou =
            fabricante !== undefined ||
            modelo !== undefined ||
            plataforma !== undefined ||
            serial !== undefined ||
            d.firmware !== undefined ||
            quantidade !== undefined;
          return {
            ...(d.id !== undefined ? { id: d.id } : {}),
            ...(d.nome !== undefined ? { nome: d.nome } : {}),
            ...(d.ip !== undefined ? { ip: d.ip } : {}),
            ...(d.detalhe !== undefined ? { detalhe: d.detalhe } : {}),
            ...(d.ip_interno !== undefined ? { ip_interno: d.ip_interno } : {}),
            ...(d.porta_http_interna !== undefined
              ? { porta_http_interna: d.porta_http_interna }
              : {}),
            ...(d.porta_rtsp_interna !== undefined
              ? { porta_rtsp_interna: d.porta_rtsp_interna }
              : {}),
            ...(d.porta_servico_interna !== undefined
              ? { porta_servico_interna: d.porta_servico_interna }
              : {}),
            ...(d.firmware !== undefined ? { firmware: d.firmware } : {}),
            ...(d.onvif !== undefined ? { onvif: d.onvif } : {}),
            ...(fabricante ? { fabricante } : {}),
            ...(modelo ? { modelo } : {}),
            ...(plataforma ? { plataforma } : {}),
            ...(driver ? { driver } : {}),
            ...(serial ? { serial } : {}),
            ...(quantidade ? { quantidade_cameras: quantidade } : {}),
            ...(confianca !== undefined ? { deteccao_confianca: confianca } : {}),
            online: normalizarOnline(bruto) ?? detectou,
          };
        });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("registrar_heartbeat", {
          _licenca: p.licenca,
          _token: chave,
          ...(p.versao !== undefined ? { _versao: p.versao } : {}),
          ...(p.uptime_segundos !== undefined ? { _uptime: p.uptime_segundos } : {}),
          ...(p.disco_percentual !== undefined ? { _disco: p.disco_percentual } : {}),
          ...(dvrs.length ? { _dvrs: dvrs } : {}),
        });

        if (error) return new Response("Falha ao registrar sinal", { status: 500 });
        const res = data as { ok?: boolean; servidor_id?: string } | null;
        if (!res?.ok) return new Response("Licença ou chave inválida", { status: 401 });

        const cat = {
          recebidos: (p.arquivos_gravados ?? []).length,
          inseridos: 0,
          atualizados: 0,
          rejeitados: 0,
          erros: [] as string[],
        };

        if (res.servidor_id) {
          const agora = new Date().toISOString();
          const midia = p.midia;
          await supabaseAdmin
            .from("servidores")
            .update({
              ultimo_payload: JSON.parse(
                JSON.stringify({ recebido_em: agora, dvrs: p.dvrs, midia: midia ?? null }),
              ),
              ...(p.gravacao
                ? ({
                    gravacao: JSON.parse(JSON.stringify(p.gravacao)),
                    gravacao_em: agora,
                  } as never)
                : {}),
              ...(p.discos
                ? ({
                    discos: JSON.parse(JSON.stringify(p.discos)),
                    discos_em: agora,
                  } as never)
                : {}),
              // Observabilidade: só marca sincronização quando o heartbeat
              // realmente trouxe dados enriquecidos (discos/catálogo/gravação).
              ...(p.discos || p.arquivos_gravados || p.gravacao
                ? ({
                    sincronizacao: {
                      em: agora,
                      discos: (p.discos ?? []).length,
                      arquivos_recebidos: (p.arquivos_gravados ?? []).length,
                      gravacao: Boolean(p.gravacao),
                      versao: p.versao ?? null,
                    },
                    sincronizacao_em: agora,
                  } as never)
                : {}),
              ...(p.metricas_agent
                ? {
                    metricas_agent: JSON.parse(JSON.stringify(p.metricas_agent)),
                    metricas_agent_em: agora,
                  }
                : {}),

              ...(midia
                ? {
                    midia_gateway_online: Boolean(
                      midia.gateway_local_online ?? midia.gateway_online ?? false,
                    ),
                    midia_modo: midia.modo ?? null,
                    midia_hls_base: midia.hls_base_url?.replace(/\/+$/, "") ?? null,
                    midia_webrtc: midia.webrtc ? JSON.parse(JSON.stringify(midia.webrtc)) : null,
                  }
                : {}),
            })
            .eq("id", res.servidor_id);

          // Estado por câmera gravada. Só aceitamos DVRs deste servidor.
          // Lista vazia limpa o estado anterior; campo ausente preserva (Agent antigo).
          if (p.gravacoes) {
            const tabela = supabaseAdmin.from("gravacao_status" as never);
            const ids = Array.from(new Set(p.gravacoes.map((g) => g.dvr_id)));
            const { data: meus } = ids.length
              ? await supabaseAdmin
                  .from("dvrs")
                  .select("id")
                  .eq("servidor_id", res.servidor_id)
                  .in("id", ids)
              : { data: [] as { id: string }[] };
            const permitidos = new Set((meus ?? []).map((d) => d.id));
            const linhas = p.gravacoes
              .filter((g) => permitidos.has(g.dvr_id))
              .map((g) => ({
                servidor_id: res.servidor_id!,
                dvr_id: g.dvr_id,
                canal: g.canal,
                estado: g.estado,
                qualidade: g.qualidade ?? null,
                diagnostico: g.diagnostico ?? null,
                atualizado_em:
                  g.atualizado_em && !Number.isNaN(new Date(g.atualizado_em).getTime())
                    ? new Date(g.atualizado_em).toISOString()
                    : agora,
                visto_em: agora,
              }));
            if (linhas.length) {
              await tabela.upsert(linhas as never, { onConflict: "dvr_id,canal" });
            }
            await tabela.delete().eq("servidor_id", res.servidor_id).lt("visto_em", agora);
          }

          // Vínculo DVR -> disco (alpha 47). Só atualizamos as entradas enviadas;
          // lista ausente ou Agent offline preserva os vínculos já salvos.
          if (p.distribuicao_discos?.length) {
            const ids = Array.from(new Set(p.distribuicao_discos.map((v) => v.dvr_id)));
            const { data: meus } = await supabaseAdmin
              .from("dvrs")
              .select("id")
              .eq("servidor_id", res.servidor_id)
              .in("id", ids);
            const permitidos = new Set((meus ?? []).map((d) => d.id));
            const linhas = p.distribuicao_discos
              .filter((v) => permitidos.has(v.dvr_id))
              .map((v) => ({
                servidor_id: res.servidor_id!,
                dvr_id: v.dvr_id,
                disco_id: v.disco_id,
                disco_disponivel: v.disco_disponivel !== false,
                vinculo_fixo: v.vinculo_fixo !== false,
                estado: v.estado,
                canais_gravando: Math.max(0, v.canais_gravando ?? 0),
                atualizado_em: agora,
                visto_em: agora,
              }));
            if (linhas.length) {
              await supabaseAdmin
                .from("dvr_discos" as never)
                .upsert(linhas as never, { onConflict: "dvr_id" });
            }
          }

          // Cadastra/atualiza as câmeras pela chave dvr_id + canal
          const cameras = (midia?.cameras ?? [])
            .map((c) => {
              const derivado = doPath(c.path);
              const dvr_id = c.dvr_id ?? derivado?.dvr_id;
              const canal = c.canal ?? derivado?.canal;
              if (!dvr_id || !canal) return null;
              return { dvr_id, canal, nome: c.nome, online: c.online, path: c.path };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);

          if (cameras.length) {
            const ids = Array.from(new Set(cameras.map((c) => c.dvr_id)));
            const { data: dvrsDoServidor } = await supabaseAdmin
              .from("dvrs")
              .select("id, cliente_id")
              .eq("servidor_id", res.servidor_id)
              .in("id", ids);
            const clientePorDvr = new Map((dvrsDoServidor ?? []).map((d) => [d.id, d.cliente_id]));

            const linhas = cameras
              .filter((c) => clientePorDvr.has(c.dvr_id))
              .map((c) => ({
                dvr_id: c.dvr_id,
                canal: c.canal,
                servidor_id: res.servidor_id!,
                cliente_id: clientePorDvr.get(c.dvr_id) ?? null,
                nome: c.nome ?? null,
                online: normalizarOnline(c.online) ?? false,
                path: c.path ?? null,
                visto_em: agora,
              }));
            if (linhas.length) {
              await supabaseAdmin.from("cameras").upsert(linhas, { onConflict: "dvr_id,canal" });
            }
            // câmeras deste servidor que sumiram do catálogo ficam offline
            await supabaseAdmin
              .from("cameras")
              .update({ online: false })
              .eq("servidor_id", res.servidor_id)
              .lt("visto_em", agora);
          }

          // Agent v43: HD e relógio do DVR. Só grava quando o Agent envia os campos;
          // null é preservado (não reaproveita leitura antiga como atual).
          // Mudança de estado do HD (ok <-> problema) vira evento em eventos_hd,
          // separado de queda/retorno de conexão.
          {
            const comTelemetria = p.dvrs.filter(
              (d) =>
                d.id &&
                ("status_hd" in d || "data_hora_dvr" in d || "dados_dvr_atualizados_em" in d),
            );
            if (comTelemetria.length) {
              const { hdComProblema } = await import("@/lib/dvr-telemetria");
              const { data: meus } = await supabaseAdmin
                .from("dvrs")
                .select("id, cliente_id, hd_com_problema" as "id")
                .eq("servidor_id", res.servidor_id);
              const porId = new Map(
                ((meus ?? []) as unknown as {
                  id: string;
                  cliente_id: string | null;
                  hd_com_problema: boolean | null;
                }[]).map((d) => [d.id.toLowerCase(), d]),
              );
              for (const d of comTelemetria) {
                const id = d.id!.toLowerCase();
                const atual = porId.get(id);
                if (!atual) continue;
                const coleta = d.dados_dvr_atualizados_em
                  ? new Date(d.dados_dvr_atualizados_em)
                  : null;
                const estadoHd = hdComProblema(d.status_hd);
                const update: Record<string, unknown> = {
                  status_hd: d.status_hd ?? null,
                  data_hora_dvr: d.data_hora_dvr ?? null,
                  dados_dvr_atualizados_em:
                    coleta && !isNaN(coleta.getTime()) ? coleta.toISOString() : null,
                };
                // sem informação de HD não muda o estado (não inventa normalização)
                if (estadoHd !== null && estadoHd !== atual.hd_com_problema) {
                  update["hd_com_problema"] = estadoHd;
                  // primeira leitura ok não gera "normalizou"
                  if (estadoHd || atual.hd_com_problema === true) {
                    await supabaseAdmin.from("eventos_hd" as never).insert({
                      dvr_id: id,
                      cliente_id: atual.cliente_id,
                      servidor_id: res.servidor_id,
                      tipo: estadoHd ? "problema" : "normalizou",
                      status_hd: d.status_hd ?? null,
                    } as never);
                  }
                }
                await supabaseAdmin.from("dvrs").update(update as never).eq("id", id);
              }
            }
          }

          // Saúde/conectividade dos DVRs (alpha 54): atualiza SOMENTE as colunas
          // de status; fabricante, modelo e canais nunca são sobrescritos aqui.
          {
            const saude = new Map<string, SaudeDvr>();
            const registrar = (item: SaudeDvr | null) => {
              if (!item) return;
              const anterior = saude.get(item.dvr_id);
              // a informação de saúde mais recente prevalece
              if (
                anterior &&
                (anterior.status_atualizado_em ?? "") > (item.status_atualizado_em ?? "")
              )
                return;
              saude.set(item.dvr_id, item);
            };
            for (const d of p.dvrs) registrar(saudeDoItem(d.id, d));
            for (const s of p.saude_dvrs ?? []) registrar(saudeDoItem(s.dvr_id ?? s.id, s));

            if (saude.size) {
              const { data: meus } = await supabaseAdmin
                .from("dvrs")
                .select("id")
                .eq("servidor_id", res.servidor_id);
              const permitidos = new Set((meus ?? []).map((d) => d.id.toLowerCase()));
              for (const [id, s] of saude) {
                if (!permitidos.has(id)) continue;
                const patch: Record<string, unknown> = {
                  status_texto: s.status,
                  status_motivo: s.status_motivo,
                  status_origem: s.status_origem,
                  status_rtsp: s.rtsp,
                  status_http: s.http,
                  status_video: s.video,
                  status_atualizado_em: s.status_atualizado_em ?? agora,
                };
                if (s.ultimo_sinal_em) patch["ultimo_sinal_em"] = s.ultimo_sinal_em;
                // estado pendente não derruba o DVR para offline
                if (s.status !== "indeterminado") {
                  patch["online"] = s.status === "online";
                  patch["ultimo_status_em"] = s.status_atualizado_em ?? agora;
                }
                await supabaseAdmin
                  .from("dvrs")
                  .update(patch as never)
                  .eq("id", id);
              }
            }
          }

          // Layout automático de cada DVR acompanha a quantidade de câmeras
          // detectada pelo servidor (antes ficava preso na quantidade inicial).
          {
            const { data: dvrsServidor } = await supabaseAdmin
              .from("dvrs")
              .select("id, nome, canais, cliente_id")
              .eq("servidor_id", res.servidor_id);
            const listaDvrs = dvrsServidor ?? [];
            const clientes = Array.from(new Set(listaDvrs.map((d) => d.cliente_id)));
            if (listaDvrs.length && clientes.length) {
              const { data: layouts } = await supabaseAdmin
                .from("layouts_visualizacao")
                .select("id, slots, template, cliente_id")
                .in("cliente_id", clientes)
                .like("template", "auto-%");
              for (const dvr of listaDvrs) {
                const total = Math.max(1, Math.min(64, dvr.canais || 1));
                const layout = (layouts ?? []).find((l) => {
                  const s = Array.isArray(l.slots) ? (l.slots as { dvr_id?: string }[]) : [];
                  return (
                    l.cliente_id === dvr.cliente_id &&
                    s.length > 0 &&
                    s.every((x) => x?.dvr_id === dvr.id)
                  );
                });
                if (!layout) continue;
                const atuais = Array.isArray(layout.slots) ? layout.slots.length : 0;
                if (atuais >= total) continue;
                const auto = mosaicoAutomatico(total);
                await supabaseAdmin
                  .from("layouts_visualizacao")
                  .update({
                    colunas: auto.colunas,
                    linhas: auto.linhas,
                    template: `auto-${total}`,
                    slots: Array.from({ length: total }, (_, i) => ({
                      dvr_id: dvr.id,
                      canal: i + 1,
                    })) as unknown as Json,
                  })
                  .eq("id", layout.id);
              }
            }
          }

          // Catálogo de gravações locais: upsert idempotente pelo id estável (texto, SHA-256).
          const brutos = p.arquivos_gravados ?? [];
          if (brutos.length) {
            const validos: z.infer<typeof arquivoSchema>[] = [];
            for (const item of brutos) {
              const r = arquivoSchema.safeParse(item);
              if (!r.success) {
                cat.rejeitados++;
                if (cat.erros.length < 20) {
                  const id =
                    typeof (item as { id?: unknown })?.id === "string"
                      ? (item as { id: string }).id
                      : "sem-id";
                  cat.erros.push(`${id}: ${r.error.issues[0]?.message ?? "inválido"}`);
                }
                continue;
              }
              if (Number.isNaN(new Date(r.data.inicio).getTime())) {
                cat.rejeitados++;
                if (cat.erros.length < 20) cat.erros.push(`${r.data.id}: início inválido`);
                continue;
              }
              validos.push(r.data);
            }

            const idsDvr = Array.from(
              new Set(validos.map((a) => a.dvr_id).filter((v): v is string => !!v)),
            );
            const { data: dvrsDoServidor } = idsDvr.length
              ? await supabaseAdmin
                  .from("dvrs")
                  .select("id, cliente_id")
                  .eq("servidor_id", res.servidor_id)
                  .in("id", idsDvr)
              : { data: [] as { id: string; cliente_id: string }[] };
            const clientePorDvr = new Map((dvrsDoServidor ?? []).map((d) => [d.id, d.cliente_id]));

            const linhas = validos.map((a) => {
              const inicio = new Date(a.inicio);
              const fim = a.fim ? new Date(a.fim) : null;
              // O arquivo só pertence a um DVR deste servidor
              const dvrId = a.dvr_id && clientePorDvr.has(a.dvr_id) ? a.dvr_id : null;
              return {
                id: a.id,
                servidor_id: res.servidor_id!,
                dvr_id: dvrId,
                cliente_id: dvrId ? (clientePorDvr.get(dvrId) ?? null) : null,
                dvr_nome: a.dvr_nome ?? null,
                canal: a.canal ?? null,
                camera_nome: a.camera_nome ?? null,
                inicio: inicio.toISOString(),
                fim: fim && !Number.isNaN(fim.getTime()) ? fim.toISOString() : null,
                duracao_segundos: a.duracao_segundos ?? null,
                tamanho_bytes: a.tamanho_bytes ?? null,
                // O agente só envia o que existe no disco; sem o campo, o arquivo está disponível.
                disponivel: a.disponivel ?? true,
                formato: a.formato ?? null,
                inicio_epoch_ms: a.inicio_epoch_ms ?? inicio.getTime(),
                fuso_horario: a.fuso_horario ?? null,
                download_url: a.download_url ?? null,
                download_range: a.download_range ?? false,
                visto_em: agora,
              };
            });

            if (linhas.length) {
              // quantos já existiam, para separar inseridos de atualizados
              const existentes = new Set<string>();
              for (let i = 0; i < linhas.length; i += 500) {
                const fatia = linhas.slice(i, i + 500).map((l) => l.id);
                const { data: achados } = await supabaseAdmin
                  .from("arquivos_gravados")
                  .select("id")
                  .in("id", fatia);
                for (const a of achados ?? []) existentes.add(a.id);
              }

              // grava em lotes; se um lote falhar, tenta item a item para não perder o resto
              for (let i = 0; i < linhas.length; i += 200) {
                const lote = linhas.slice(i, i + 200);
                const { error: erroLote } = await supabaseAdmin
                  .from("arquivos_gravados")
                  .upsert(lote, { onConflict: "id" });
                if (!erroLote) {
                  for (const l of lote) {
                    if (existentes.has(l.id)) cat.atualizados++;
                    else cat.inseridos++;
                  }
                  continue;
                }
                for (const l of lote) {
                  const { error: erroItem } = await supabaseAdmin
                    .from("arquivos_gravados")
                    .upsert(l, { onConflict: "id" });
                  if (erroItem) {
                    cat.rejeitados++;
                    if (cat.erros.length < 20) cat.erros.push(`${l.id}: ${erroItem.message}`);
                  } else if (existentes.has(l.id)) cat.atualizados++;
                  else cat.inseridos++;
                }
              }
            }

            // O Agent envia o histórico em lotes (até 500 por heartbeat): um arquivo
            // ausente neste lote NÃO é removido. Indisponibilidade só por disponivel:false.
          }
        }

        // Pedidos de foto do Gear também vão no heartbeat (o Agent consulta o GET só ao iniciar).
        let snapshotsPedidos: { dvr_id: string; canais: number[]; ate: string }[] = [];
        if (res.servidor_id) {
          try {
            const { data: dvrsSrv } = await supabaseAdmin
              .from("dvrs")
              .select("id")
              .eq("servidor_id", res.servidor_id);
            const { snapshotsSolicitados } = await import("@/lib/snapshot-cache.server");
            snapshotsPedidos = snapshotsSolicitados(
              ((dvrsSrv ?? []) as { id: string }[]).map((d) => d.id),
            ) as typeof snapshotsPedidos;
          } catch {
            snapshotsPedidos = [];
          }
        }

        return Response.json({
          ok: true,
          recebido_em: new Date().toISOString(),
          snapshots_solicitados: snapshotsPedidos,
          arquivos_recebidos: cat.recebidos,
          arquivos_inseridos: cat.inseridos,
          arquivos_atualizados: cat.atualizados,
          arquivos_rejeitados: cat.rejeitados,
          erros: cat.erros,
        });
      },
    },
  },
});
