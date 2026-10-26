import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


type ContextoLog = { userId: string; claims: { email?: string } };

/** Grava uma linha no Log com o nome de quem fez e, se houver, de quem recebeu. */
async function gravarLog(
  context: ContextoLog,
  alvoId: string | null,
  registroId: string | null,
  montar: (responsavel: string, alvo: string) => string,
  detalhes?: Record<string, unknown>,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ids = [context.userId, ...(alvoId ? [alvoId] : [])];
  const { data: perfis } = await supabaseAdmin.from("profiles").select("id, nome, email").in("id", ids);
  const perfil = perfis?.find((p) => p.id === context.userId);
  const perfilAlvo = alvoId ? perfis?.find((p) => p.id === alvoId) : null;
  const responsavel = perfil?.nome ?? context.claims.email ?? "Usuário";
  const alvo = perfilAlvo?.nome ?? "usuário";
  const { error } = await supabaseAdmin.from("logs_auditoria").insert({
    user_id: context.userId,
    user_nome: responsavel,
    user_email: perfil?.email ?? context.claims.email ?? null,
    acao: "editou",
    tabela: alvoId && alvoId !== context.userId ? "Monitoramento" : "Visualização",
    registro_id: registroId,
    descricao: montar(responsavel, alvo),
    depois: detalhes ? ({ ...detalhes, ...(alvoId ? { usuario: alvo } : {}) } as never) : null,
  });
  if (error) console.error("Falha ao gravar log", error);
}

/** Registra ações do próprio usuário na Visualização (abrir/trocar mosaico, telas). */
export const registrarAtividade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { descricao: string; registroId?: string | null; detalhes?: Record<string, unknown> }) => {
    if (!input || typeof input.descricao !== "string" || !input.descricao.trim()) throw new Error("Descrição inválida");
    return { descricao: input.descricao.slice(0, 300), registroId: input.registroId ?? null, detalhes: input.detalhes };
  })
  .handler(async ({ data, context }) => {
    await gravarLog(context, null, data.registroId, (r) => `${r} ${data.descricao}`, data.detalhes);
    return { ok: true };
  });

type Entrada = { sessaoId: string; layoutId: string | null };

/**
 * Envia (ou cancela) a troca de mosaico para a sessão de outro usuário.
 * Só quem tem a permissão de Monitoramento pode executar.
 */
export const forcarLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Entrada) => {
    if (!input || typeof input.sessaoId !== "string" || !input.sessaoId) {
      throw new Error("Sessão inválida");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: perm }, { data: admin }] = await Promise.all([
      supabase.rpc("has_permission", { _user_id: userId, _perm: "monitoramento.ver" }),
      supabase.rpc("is_admin", { _user_id: userId }),
    ]);
    if (!perm && !admin) throw new Error("Sem permissão para monitorar usuários");

    const { data: sessao, error: erroSessao } = await supabase
      .from("sessoes_usuario")
      .select("id, user_id, cliente_id")
      .eq("id", data.sessaoId)
      .maybeSingle();
    if (erroSessao) throw erroSessao;
    if (!sessao) throw new Error("Sessão não encontrada");

    let nomeLayout: string | null = null;
    if (data.layoutId) {
      const { data: layout, error: erroLayout } = await supabase
        .from("layouts_visualizacao")
        .select("id, nome, cliente_id")
        .eq("id", data.layoutId)
        .maybeSingle();
      if (erroLayout) throw erroLayout;
      if (!layout) throw new Error("Layout não encontrado");
      nomeLayout = layout.nome;
    }

    const { error } = await supabase
      .from("sessoes_usuario")
      .update({
        layout_forcado: data.layoutId,
        forcado_em: data.layoutId ? new Date().toISOString() : null,
        forcado_por: data.layoutId ? userId : null,
      })
      .eq("id", data.sessaoId);
    if (error) throw error;

    // registro de auditoria (a tabela de log só aceita escrita privilegiada)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: perfis, error: erroPerfis } = await supabaseAdmin
      .from("profiles")
      .select("id, nome, email")
      .in("id", [userId, sessao.user_id]);
    if (erroPerfis) throw erroPerfis;

    const perfil = perfis?.find((item) => item.id === userId);
    const perfilAlvo = perfis?.find((item) => item.id === sessao.user_id);
    const nomeResponsavel = perfil?.nome ?? context.claims.email ?? "Usuário";
    const nomeAlvo = perfilAlvo?.nome ?? "usuário monitorado";

    const { error: erroLog } = await supabaseAdmin.from("logs_auditoria").insert({
      user_id: userId,
      user_nome: nomeResponsavel,
      user_email: perfil?.email ?? context.claims.email ?? null,
      acao: "editou",
      tabela: "Monitoramento",
      registro_id: data.sessaoId,
      descricao: data.layoutId
        ? `${nomeResponsavel} alterou o mosaico de ${nomeAlvo} para "${nomeLayout}"`
        : `${nomeResponsavel} devolveu o controle do mosaico para ${nomeAlvo}`,
    });
    if (erroLog) throw erroLog;

    return { ok: true };
  });

type EntradaIdentificar = { sessaoId: string; rotulo: string };

/** Mostra por alguns segundos o número da tela no monitor daquele usuário. */
export const identificarTela = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EntradaIdentificar) => {
    if (!input || typeof input.sessaoId !== "string" || !input.sessaoId) {
      throw new Error("Sessão inválida");
    }
    return { sessaoId: input.sessaoId, rotulo: String(input.rotulo ?? "").slice(0, 40) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: perm }, { data: admin }] = await Promise.all([
      supabase.rpc("has_permission", { _user_id: userId, _perm: "monitoramento.ver" }),
      supabase.rpc("is_admin", { _user_id: userId }),
    ]);
    if (!perm && !admin) throw new Error("Sem permissão para monitorar usuários");

    const { error } = await supabase
      .from("sessoes_usuario")
      .update({
        identificar_em: new Date().toISOString(),
        identificar_rotulo: data.rotulo,
      })
      .eq("id", data.sessaoId);
    if (error) throw error;
    const { data: s } = await supabase.from("sessoes_usuario").select("user_id").eq("id", data.sessaoId).maybeSingle();
    await gravarLog(context, s?.user_id ?? null, data.sessaoId,
      (r, a) => `${r} identificou a tela "${data.rotulo || "sem nome"}" de ${a}`, { tela: data.rotulo });

    return { ok: true };
  });

/** Envia à janela principal um único pedido para identificar todos os monitores. */
export const identificarMonitoresDoUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EntradaIniciarTelas) => {
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.userId)) throw new Error("Usuário inválido");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: perm }, { data: admin }] = await Promise.all([
      supabase.rpc("has_permission", { _user_id: userId, _perm: "monitoramento.ver" }),
      supabase.rpc("is_admin", { _user_id: userId }),
    ]);
    if (!perm && !admin) throw new Error("Sem permissão para monitorar usuários");
    if (data.userId !== userId) {
      const [{ data: alvoMaster }, { data: souMaster }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: data.userId, _role: "master" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "master" }),
      ]);
      if (alvoMaster && !souMaster) throw new Error("Usuário não encontrado");
    }

    const limite = new Date(Date.now() - 120_000).toISOString();
    const { data: principal, error: erroSessao } = await supabase
      .from("sessoes_usuario")
      .select("id")
      .eq("user_id", data.userId)
      .not("sessao", "like", "tela-%")
      .gte("updated_at", limite)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroSessao) throw erroSessao;
    if (!principal) throw new Error("A janela principal deste usuário não está conectada");

    const { error } = await supabase
      .from("sessoes_usuario")
      .update({
        identificar_em: new Date().toISOString(),
        identificar_rotulo: "todos-os-monitores",
      })
      .eq("id", principal.id);
    if (error) throw error;
    await gravarLog(context, data.userId, principal.id, (r, a) => `${r} identificou todos os monitores de ${a}`);
    return { ok: true };
  });

type EntradaIniciarTelas = { userId: string };

type MonitorOrganizado = {
  numero?: number;
  id?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  layoutId?: string | null;
};

/** Entrega à janela principal do usuário a solicitação para abrir seus mosaicos. */
export const iniciarTelasDoUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EntradaIniciarTelas) => {
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.userId)) throw new Error("Usuário inválido");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: perm }, { data: admin }] = await Promise.all([
      supabase.rpc("has_permission", { _user_id: userId, _perm: "monitoramento.ver" }),
      supabase.rpc("is_admin", { _user_id: userId }),
    ]);
    if (!perm && !admin) throw new Error("Sem permissão para monitorar usuários");
    if (data.userId !== userId) {
      const [{ data: alvoMaster }, { data: souMaster }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: data.userId, _role: "master" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "master" }),
      ]);
      if (alvoMaster && !souMaster) throw new Error("Usuário não encontrado");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type ClientePrivilegiado = {
      from: (tabela: string) => {
        select: (campos: string) => unknown;
        update: (valores: Record<string, unknown>) => unknown;
      };
    };
    type ConsultaOrganizacao = {
      eq: (campo: string, valor: string) => {
        maybeSingle: () => Promise<{
          data: { cliente_id: string | null; monitores: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
    const adminSemTiposNovos = supabaseAdmin as unknown as ClientePrivilegiado;
    const { data: organizacao, error: erroOrganizacao } = await (adminSemTiposNovos
      .from("organizacao_telas")
      .select("cliente_id, monitores") as ConsultaOrganizacao)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (erroOrganizacao) throw erroOrganizacao;
    if (!organizacao) throw new Error("Salve primeiro a organização das telas deste usuário");

    const monitores = Array.isArray(organizacao.monitores)
      ? (organizacao.monitores as MonitorOrganizado[])
      : [];
    const telas = monitores.flatMap((monitor) => {
      if (
        !monitor.layoutId ||
        typeof monitor.numero !== "number" ||
        typeof monitor.left !== "number" ||
        typeof monitor.top !== "number" ||
        typeof monitor.width !== "number" ||
        typeof monitor.height !== "number"
      ) return [];
      return [{
        id: `organizado-${monitor.numero}`,
        layoutId: monitor.layoutId,
        clienteId: organizacao.cliente_id,
        left: monitor.left,
        top: monitor.top,
        width: monitor.width,
        height: monitor.height,
        monitorId: monitor.id ?? null,
        telaCheia: true,
      }];
    });
    if (!telas.length) throw new Error("Defina e salve um mosaico para pelo menos um monitor");

    const limite = new Date(Date.now() - 120_000).toISOString();
    type ConsultaSessao = {
      eq: (campo: string, valor: string) => ConsultaSessao;
      not: (campo: string, operador: string, valor: string) => ConsultaSessao;
      gte: (campo: string, valor: string) => ConsultaSessao;
      order: (campo: string, opcoes: { ascending: boolean }) => ConsultaSessao;
      limit: (quantidade: number) => ConsultaSessao;
      maybeSingle: () => Promise<{
        data: { id: string } | null;
        error: { message: string } | null;
      }>;
    };
    const { data: principal, error: erroSessao } = await (adminSemTiposNovos
      .from("sessoes_usuario")
      .select("id") as ConsultaSessao)
      .eq("user_id", data.userId)
      .not("sessao", "like", "tela-%")
      .gte("updated_at", limite)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroSessao) throw erroSessao;
    if (!principal) throw new Error("A janela principal deste usuário não está conectada");

    const enviadoEm = new Date().toISOString();
    const comando = { id: crypto.randomUUID(), telas };
    type AtualizacaoSessao = {
      eq: (campo: string, valor: string) => Promise<{ error: { message: string } | null }>;
    };
    const { error } = await (adminSemTiposNovos
      .from("sessoes_usuario")
      .update({ abrir_telas: comando, abrir_telas_em: enviadoEm, abrir_telas_por: userId }) as AtualizacaoSessao)
      .eq("id", principal.id);
    if (error) {
      if (/abrir_telas/i.test(error.message)) {
        throw new Error("A atualização de abertura remota ainda não foi aplicada no banco");
      }
      throw error;
    }
    const ids = [...new Set(telas.map((t) => t.layoutId))];
    const { data: lays } = await supabaseAdmin.from("layouts_visualizacao").select("id, nome").in("id", ids);
    const nomeDe = (id: string) => lays?.find((l) => l.id === id)?.nome ?? "mosaico";
    const lista = telas.map((t) => `Tela ${t.id.replace("organizado-", "")}: ${nomeDe(t.layoutId)}`).join("; ");
    await gravarLog(context, data.userId, principal.id,
      (r, a) => `${r} enviou ${telas.length} tela(s) para ${a} — ${lista}`,
      { telas: lista });
    return { ok: true, quantidade: telas.length };
  });
