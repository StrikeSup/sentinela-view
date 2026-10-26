import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["master", "admin", "operador", "visualizador"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function garantirAdmin(supabaseUser: any, userId: string) {
  const { data } = await supabaseUser.rpc("is_admin", { _user_id: userId });
  if (!data) throw new Error("Você não tem permissão para gerenciar usuários.");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function garantirPodeDefinirMaster(supabaseUser: any, userId: string, role: string) {
  if (role !== "master" && role !== "admin") return;
  const { data } = await supabaseUser.rpc("has_role", { _user_id: userId, _role: "master" });
  if (!data)
    throw new Error("Apenas o perfil Master pode definir usuários como Master ou Administrador.");
}

/** Quem não é Master não pode mexer em um usuário Master. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function garantirAlvoPermitido(supabaseUser: any, userId: string, alvoId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: alvo } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", alvoId)
    .eq("role", "master")
    .maybeSingle();
  if (!alvo) return;
  const { data } = await supabaseUser.rpc("has_role", { _user_id: userId, _role: "master" });
  if (!data) throw new Error("Usuário não encontrado.");
}

// Restringe as permissões às telas liberadas nos clientes do usuário
// (união). Cliente sem configuração (null) libera tudo.
async function filtrarPermsCliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (t: string) => any },
  permissions: string[],
  clienteIds: string[],
): Promise<string[]> {
  if (!clienteIds.length || !permissions.length) return permissions;
  const { data } = await admin
    .from("clientes")
    .select("id, permissoes_permitidas")
    .in("id", clienteIds);
  const linhas = (data ?? []) as { permissoes_permitidas: string[] | null }[];
  if (!linhas.length || linhas.some((c) => !c.permissoes_permitidas)) return permissions;
  const ok = new Set(linhas.flatMap((c) => c.permissoes_permitidas ?? []));
  return permissions.filter((p) => ok.has(p));
}

/** Retrato do usuário (dados, perfil, permissões e clientes) para o log. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retratoUsuario(admin: any, userId: string) {
  const [{ data: perfil }, { data: roles }, { data: perms }, { data: clis }] = await Promise.all([
    admin.from("profiles").select("nome, email, ativo, perfil_id, restaurar_sessao").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("user_permissions").select("permission").eq("user_id", userId),
    admin.from("user_clientes").select("cliente_id").eq("user_id", userId),
  ]);
  if (!perfil) return null;
  const ids = ((clis ?? []) as { cliente_id: string }[]).map((c) => c.cliente_id);
  let nomesClientes: string[] = [];
  if (ids.length) {
    const { data } = await admin.from("clientes").select("nome").in("id", ids);
    nomesClientes = ((data ?? []) as { nome: string }[]).map((c) => c.nome).sort();
  }
  return {
    nome: perfil.nome,
    email: perfil.email,
    ativo: perfil.ativo,
    restaurar_sessao: perfil.restaurar_sessao,
    base_role: ((roles ?? []) as { role: string }[])[0]?.role ?? null,
    permissions: ((perms ?? []) as { permission: string }[]).map((p) => p.permission).sort(),
    clientes: nomesClientes,
  };
}

/** Grava no log de atividades quem alterou o usuário e o que mudou. */
async function logUsuario(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  autorId: string,
  acao: "criou" | "editou" | "excluiu",
  alvoId: string,
  antes: unknown,
  depois: unknown,
) {
  const { data: autor } = await admin
    .from("profiles")
    .select("nome, email")
    .eq("id", autorId)
    .maybeSingle();
  const alvo =
    (depois as { nome?: string } | null)?.nome ??
    (antes as { nome?: string } | null)?.nome ??
    alvoId;
  await admin.from("logs_auditoria").insert({
    user_id: autorId,
    user_nome: autor?.nome ?? null,
    user_email: autor?.email ?? null,
    acao,
    tabela: "Usuários",
    registro_id: alvoId,
    descricao: `${acao} usuário: ${alvo}`,
    antes: antes ?? null,
    depois: depois ?? null,
  });
}

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email(),
        senha: z.string().min(6),
        nome: z.string().min(1).max(120),
        role: roleSchema,
        permissions: z.array(z.string()).default([]),
        clienteIds: z.array(z.string().uuid()).default([]),
        perfilId: z.string().uuid().nullable().default(null),
        restaurarSessao: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await garantirAdmin(context.supabase, context.userId);
    await garantirPodeDefinirMaster(context.supabase, context.userId, data.role);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error) throw new Error(error.message);
    const uid = created.user.id;

    await supabaseAdmin.from("profiles").upsert({
      id: uid,
      nome: data.nome,
      email: data.email,
      perfil_id: data.perfilId,
      restaurar_sessao: data.restaurarSessao,
    } as never);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", uid);
    data.permissions = await filtrarPermsCliente(
      supabaseAdmin as never,
      data.permissions,
      data.clienteIds,
    );
    if (data.permissions.length) {
      await supabaseAdmin
        .from("user_permissions")
        .insert(data.permissions.map((p) => ({ user_id: uid, permission: p as never })));
    }
    // vínculo com clientes
    await supabaseAdmin.from("user_clientes").delete().eq("user_id", uid);
    if (data.clienteIds.length) {
      await supabaseAdmin
        .from("user_clientes")
        .insert(data.clienteIds.map((cid) => ({ user_id: uid, cliente_id: cid })));
    }
    await logUsuario(
      supabaseAdmin,
      context.userId,
      "criou",
      uid,
      null,
      await retratoUsuario(supabaseAdmin, uid),
    );
    return { id: uid };
  });

export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        nome: z.string().min(1).max(120),
        role: roleSchema,
        permissions: z.array(z.string()).default([]),
        ativo: z.boolean().default(true),
        clienteIds: z.array(z.string().uuid()).default([]),
        perfilId: z.string().uuid().nullable().default(null),
        restaurarSessao: z.boolean().default(true),
        senha: z.string().min(6).max(72).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await garantirAdmin(context.supabase, context.userId);
    await garantirPodeDefinirMaster(context.supabase, context.userId, data.role);
    await garantirAlvoPermitido(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const antes = await retratoUsuario(supabaseAdmin, data.userId);

    if (data.senha) {
      const { error: erroSenha } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        password: data.senha,
      });
      if (erroSenha) throw new Error(erroSenha.message);
    }

    await supabaseAdmin
      .from("profiles")
      .update({
        nome: data.nome,
        ativo: data.ativo,
        perfil_id: data.perfilId,
        restaurar_sessao: data.restaurarSessao,
      } as never)
      .eq("id", data.userId);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.userId);
    data.permissions = await filtrarPermsCliente(
      supabaseAdmin as never,
      data.permissions,
      data.clienteIds,
    );
    if (data.permissions.length) {
      await supabaseAdmin
        .from("user_permissions")
        .insert(data.permissions.map((p) => ({ user_id: data.userId, permission: p as never })));
    }
    // vínculo com clientes
    await supabaseAdmin.from("user_clientes").delete().eq("user_id", data.userId);
    if (data.clienteIds.length) {
      await supabaseAdmin
        .from("user_clientes")
        .insert(data.clienteIds.map((cid) => ({ user_id: data.userId, cliente_id: cid })));
    }
    await logUsuario(
      supabaseAdmin,
      context.userId,
      "editou",
      data.userId,
      antes,
      await retratoUsuario(supabaseAdmin, data.userId),
    );
    return { ok: true };
  });

export const excluirUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await garantirAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("Você não pode excluir a própria conta.");
    await garantirAlvoPermitido(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const antes = await retratoUsuario(supabaseAdmin, data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await logUsuario(supabaseAdmin, context.userId, "excluiu", data.userId, antes, null);
    return { ok: true };
  });
