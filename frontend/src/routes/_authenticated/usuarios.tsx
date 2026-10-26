import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { AjudaJanela } from "@/components/AjudaJanela";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, ShieldCheck, Copy, Search } from "lucide-react";
import { ComboSelect } from "@/components/ComboSelect";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";
import { Paginacao, usePaginacao } from "@/components/Paginacao";

import { PERMISSOES, useAuth, type AppPermission, type AppRole } from "@/lib/auth";
import { atualizarUsuario, criarUsuario, excluirUsuario } from "@/lib/usuarios.functions";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Sentinela VIEW" },
      { name: "description", content: "Criação de usuários e permissões do sistema." },
      { property: "og:title", content: "Usuários — Sentinela VIEW" },
      { property: "og:description", content: "Criação de usuários e permissões do sistema." },
    ],
  }),
  component: UsuariosPage,
});

const ROLES: { value: AppRole; label: string }[] = [
  { value: "master", label: "Master" },
  { value: "admin", label: "Administrador" },
  { value: "operador", label: "Operador" },
  { value: "visualizador", label: "Visualizador" },
];

function UsuariosPage() {
  const { isAdmin, isMaster, clienteIds: meusClientes } = useAuth();
  const qc = useQueryClient();
  const criar = useServerFn(criarUsuario);
  const atualizar = useServerFn(atualizarUsuario);
  const excluirFn = useServerFn(excluirUsuario);

  const usuarios = useQuery({
    queryKey: ["usuarios", isMaster],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: perms }, { data: uclis }] =
        await Promise.all([
          supabase.from("profiles").select("*").order("nome"),
          supabase.from("user_roles").select("user_id, role"),
          supabase.from("user_permissions").select("user_id, permission"),
          supabase.from("user_clientes").select("user_id, cliente_id"),
        ]);
      const listaRoles = (roles ?? []) as { user_id: string; role: AppRole }[];
      const listaPerms = (perms ?? []) as { user_id: string; permission: AppPermission }[];
      const listaUclis = (uclis ?? []) as { user_id: string; cliente_id: string }[];
      const masters = new Set(listaRoles.filter((r) => r.role === "master").map((r) => r.user_id));
      return (profiles ?? [])
        .filter((p) => isMaster || !masters.has(p.id))
        .map((p) => ({
          ...p,
          role: listaRoles.find((r) => r.user_id === p.id)?.role,
          permissions: listaPerms.filter((r) => r.user_id === p.id).map((r) => r.permission),
          clienteIds: listaUclis.filter((r) => r.user_id === p.id).map((r) => r.cliente_id),
        }));
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });

  // Só é possível conceder acesso aos clientes que o próprio usuário enxerga.
  const clientesDisponiveis = (clientes.data ?? []).filter(
    (c) => !meusClientes || meusClientes.includes(c.id),
  );
  const clienteUnico = clientesDisponiveis.length === 1 ? clientesDisponiveis[0]!.id : null;

  const perfis = useQuery({
    queryKey: ["perfis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("perfis")
        .select("id, cliente_id, nome, descricao, base_role, permissions")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const [aberto, setAberto] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [listaPerfisAberta, setListaPerfisAberta] = useState(false);
  const [formPerfil, setFormPerfil] = useState<{
    id?: string;
    cliente_id: string;
    nome: string;
    descricao: string;
    base_role: AppRole;
    permissions: AppPermission[];
  }>({ cliente_id: "", nome: "", descricao: "", base_role: "visualizador", permissions: [] });

  const salvarPerfil = useMutation({
    mutationFn: async () => {
      if (!formPerfil.cliente_id) throw new Error("Selecione o cliente deste perfil.");
      if (!formPerfil.nome.trim()) throw new Error("Informe o nome do perfil.");
      const payload = {
        cliente_id: formPerfil.cliente_id,
        nome: formPerfil.nome.trim(),
        descricao: formPerfil.descricao || null,
        base_role: formPerfil.base_role,
        permissions: formPerfil.permissions,
      };
      const { error } = formPerfil.id
        ? await supabase
            .from("perfis")
            .update(payload as never)
            .eq("id", formPerfil.id)
        : await supabase.from("perfis").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil salvo");
      setPerfilAberto(false);
      void qc.invalidateQueries({ queryKey: ["perfis"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerPerfil = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("perfis").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil excluído");
      void qc.invalidateQueries({ queryKey: ["perfis"] });
      void qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [form, setForm] = useState<{
    id?: string;
    nome: string;
    email: string;
    senha: string;
    role: AppRole;
    permissions: AppPermission[];
    clienteIds: string[];
    perfilId: string;
    ativo: boolean;
    restaurarSessao: boolean;
  }>({
    nome: "",
    email: "",
    senha: "",
    role: "visualizador",
    permissions: [],
    clienteIds: [],
    perfilId: "",
    ativo: true,
    restaurarSessao: true,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (form.id) {
        if (form.senha && form.senha.length < 6) {
          throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
        }
        await atualizar({
          data: {
            userId: form.id,
            nome: form.nome,
            role: form.role,
            permissions: form.permissions,
            ativo: form.ativo,
            clienteIds: form.clienteIds,
            perfilId: form.perfilId || null,
            restaurarSessao: form.restaurarSessao,
            ...(form.senha ? { senha: form.senha } : {}),
          },
        });
      } else {
        await criar({
          data: {
            email: form.email,
            senha: form.senha,
            nome: form.nome,
            role: form.role,
            permissions: form.permissions,
            clienteIds: form.clienteIds,
            perfilId: form.perfilId || null,
            restaurarSessao: form.restaurarSessao,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success("Usuário salvo");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["usuarios"] });
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (userId: string) => {
      await excluirFn({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("Usuário excluído");
      void qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Busca e filtro por cliente: a busca ignora acentos e maiúsculas, e o
  // filtro por cliente mostra só quem está vinculado àquele cliente.
  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("todos");

  const lista = useMemo(() => {
    const termo = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (usuarios.data ?? []).filter((u) => {
      if (filtroCliente !== "todos" && !(u.clienteIds ?? []).includes(filtroCliente)) return false;
      if (!termo) return true;
      const perfil = ROLES.find((r) => r.value === u.role)?.label ?? "";
      return [u.nome, u.email, perfil]
        .filter(Boolean)
        .some((v) =>
          String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo),
        );
    });
  }, [usuarios.data, busca, filtroCliente]);

  const pag = usePaginacao(lista);

  useEffect(() => {
    pag.setPagina(1);
  }, [busca, filtroCliente, pag.setPagina]);



  // Telas liberadas pelos clientes selecionados (união; null = tudo).
  const clientesSel = (clientes.data ?? []).filter((c) => form.clienteIds.includes(c.id)) as {
    permissoes_permitidas?: string[] | null;
  }[];
  const permitidasCliente =
    isMaster || !clientesSel.length || clientesSel.some((c) => !c.permissoes_permitidas)
      ? null
      : new Set(clientesSel.flatMap((c) => c.permissoes_permitidas ?? []));
  const permsVisiveis = PERMISSOES.filter(
    (p) => !permitidasCliente || permitidasCliente.has(p.value),
  );
  const grupos = Array.from(new Set(permsVisiveis.map((p) => p.grupo)));
  const permsDoPerfil = ((perfis.data ?? []).find((p) => p.id === form.perfilId)?.permissions ??
    []) as AppPermission[];

  // Perfis personalizados: só aparecem para os clientes vinculados ao usuário
  // que está sendo criado/editado (e sempre dentro dos clientes que eu enxergo).
  const perfisDisponiveis = (perfis.data ?? []).filter(
    (p) =>
      (!meusClientes || meusClientes.includes(p.cliente_id)) &&
      form.clienteIds.includes(p.cliente_id),
  );

  // Papéis e perfis personalizados no mesmo campo: os personalizados ficam
  // logo abaixo de Operador; Administrador e Master só para admin/master.
  const opcoesPerfil = [
    { value: "visualizador", label: "Visualizador" },
    { value: "operador", label: "Operador" },
    ...perfisDisponiveis.map((p) => ({
      value: `perfil:${p.id}`,
      label: `${p.nome} · ${clientes.data?.find((c) => c.id === p.cliente_id)?.nome ?? ""}`,
    })),
    ...(isAdmin
      ? [
          { value: "admin", label: "Administrador" },
          ...(isMaster ? [{ value: "master", label: "Master" }] : []),
        ]
      : []),
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Usuários" />
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Você não tem permissão para gerenciar usuários.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Controle de acesso, papéis e permissões dentro do sistema."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setListaPerfisAberta(true)}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Perfis
            </Button>
            <Button
              onClick={() => {
                setForm({
                  nome: "",
                  email: "",
                  senha: "",
                  role: "visualizador",
                  permissions: [],
                  clienteIds: clienteUnico ? [clienteUnico] : [],
                  perfilId: "",
                  ativo: true,
                  restaurarSessao: true,
                });
                setAberto(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Novo usuário
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="sm:w-64">
            <ComboSelect
              value={filtroCliente}
              onChange={setFiltroCliente}
              options={[
                { value: "todos", label: "Todos os clientes" },
                ...clientesDisponiveis.map((c) => ({ value: c.id, label: c.nome })),
              ]}
              placeholder="Cliente"
              searchPlaceholder="Pesquisar cliente..."
              emptyText="Nenhum cliente encontrado."
            />
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar usuário por nome, e-mail ou perfil..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Clientes</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.visiveis.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {busca.trim() || filtroCliente !== "todos"
                      ? "Nenhum usuário encontrado para estes filtros."
                      : "Nenhum usuário cadastrado."}
                  </TableCell>
                </TableRow>
              )}
              {pag.visiveis.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.nome}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "master" ? "default" : "secondary"}>
                      {ROLES.find((r) => r.value === u.role)?.label ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.role === "master" || u.role === "admin" ? (
                      <Badge variant="secondary">Todos</Badge>
                    ) : !u.clienteIds?.length ? (
                      <Badge variant="secondary">Todos</Badge>
                    ) : (
                      <span>{u.clienteIds.length} cliente(s)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.role === "master" || u.role === "admin"
                      ? "Acesso total"
                      : `${u.permissions.length} permissões`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.ativo ? "default" : "secondary"}>
                      {u.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Clonar usuário"
                      onClick={() => {
                        // Copia perfil, clientes e permissões; nome, e-mail e
                        // senha ficam em branco para o novo usuário.
                        setForm({
                          nome: "",
                          email: "",
                          senha: "",
                          role: u.role ?? "visualizador",
                          permissions: [...u.permissions],
                          clienteIds: [...(u.clienteIds ?? [])],
                          perfilId: (u as { perfil_id?: string | null }).perfil_id ?? "",
                          ativo: true,
                          restaurarSessao:
                            (u as { restaurar_sessao?: boolean | null }).restaurar_sessao !== false,
                        });
                        setAberto(true);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar usuário"
                      onClick={() => {
                        setForm({
                          id: u.id,
                          nome: u.nome,
                          email: u.email,
                          senha: "",
                          role: u.role ?? "visualizador",
                          permissions: u.permissions,
                          clienteIds: u.clienteIds ?? [],
                          perfilId: (u as { perfil_id?: string | null }).perfil_id ?? "",
                          ativo: u.ativo,
                          restaurarSessao:
                            (u as { restaurar_sessao?: boolean | null }).restaurar_sessao !== false,
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Excluir o usuário ${u.nome}?`)) remover.mutate(u.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginacao {...pag} rotulo="usuários" />
        </CardContent>
      </Card>

      <Dialog open={listaPerfisAberta} onOpenChange={setListaPerfisAberta}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Perfis personalizados</DialogTitle>
          </DialogHeader>
          {(perfis.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum perfil personalizado criado ainda.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {(perfis.data ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {clientes.data?.find((c) => c.id === p.cliente_id)?.nome ?? "Cliente"} ·{" "}
                      {ROLES.find((r) => r.value === p.base_role)?.label ?? "—"} ·{" "}
                      {(p.permissions ?? []).length} permissões
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar perfil"
                      onClick={() => {
                        setFormPerfil({
                          id: p.id,
                          cliente_id: p.cliente_id,
                          nome: p.nome,
                          descricao: p.descricao ?? "",
                          base_role: (p.base_role ?? "visualizador") as AppRole,
                          permissions: (p.permissions ?? []) as AppPermission[],
                        });
                        setListaPerfisAberta(false);
                        setPerfilAberto(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir perfil"
                      disabled={removerPerfil.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Excluir o perfil ${p.nome}? Os usuários com este perfil mantêm as permissões atuais.`,
                          )
                        )
                          removerPerfil.mutate(p.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setListaPerfisAberta(false)}>
              Fechar
            </Button>
            <Button
              onClick={() => {
                setFormPerfil({
                  cliente_id: clienteUnico ?? "",
                  nome: "",
                  descricao: "",
                  base_role: "visualizador",
                  permissions: [],
                });
                setListaPerfisAberta(false);
                setPerfilAberto(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Novo perfil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={perfilAberto} onOpenChange={setPerfilAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{formPerfil.id ? "Editar perfil" : "Novo perfil"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome do perfil</Label>
              <Input
                value={formPerfil.nome}
                placeholder="Ex.: Portaria noturna"
                onChange={(e) => setFormPerfil({ ...formPerfil, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Cliente</Label>
              <ComboSelect
                value={formPerfil.cliente_id}
                onChange={(v) => setFormPerfil({ ...formPerfil, cliente_id: v })}
                options={clientesDisponiveis.map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione o cliente"
                searchPlaceholder="Pesquisar cliente..."
                disabled={!!clienteUnico}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>

              <Input
                value={formPerfil.descricao}
                onChange={(e) => setFormPerfil({ ...formPerfil, descricao: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPerfilAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarPerfil.mutate()} disabled={salvarPerfil.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-7">
              <DialogTitle>{form.id ? "Editar usuário" : "Novo usuário"}</DialogTitle>
              <AjudaJanela
                rota="/usuarios/novo-usuario"
                titulo="Cadastrar usuário"
                aberto={aberto}
              />
            </div>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2" data-ajuda="usuario-nome">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2" data-ajuda="usuario-email">
              <Label>E-mail</Label>
              <Input
                type="email"
                disabled={!!form.id}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2" data-ajuda="usuario-senha">
              <Label>{form.id ? "Nova senha" : "Senha"}</Label>
              <div className="relative">
                <Input
                  type={verSenha ? "text" : "password"}
                  className="pr-10"
                  placeholder={form.id ? "Deixe em branco para manter" : "Mínimo de 6 caracteres"}
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2" data-ajuda="usuario-clientes">
              <Label>Clientes com acesso</Label>
              <ComboMultiSelect
                values={form.clienteIds}
                onChange={(v) => {
                  const perfil = (perfis.data ?? []).find((p) => p.id === form.perfilId);
                  const manter = perfil && v.includes(perfil.cliente_id);
                  setForm({ ...form, clienteIds: v, perfilId: manter ? form.perfilId : "" });
                }}
                options={clientesDisponiveis.map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione os clientes"
                searchPlaceholder="Pesquisar cliente..."
                emptyText="Nenhum cliente encontrado."
                disabled={!!clienteUnico}
              />
            </div>

            {/* Perfil do usuário */}
            <div className="space-y-2" data-ajuda="usuario-perfil">
              <Label>Perfil</Label>
              <ComboSelect
                value={form.perfilId ? `perfil:${form.perfilId}` : form.role}
                onChange={(v) => {
                  if (v.startsWith("perfil:")) {
                    const id = v.slice(7);
                    const p = perfisDisponiveis.find((x) => x.id === id);
                    setForm({
                      ...form,
                      perfilId: id,
                      role: (p?.base_role as AppRole) ?? "visualizador",
                    });
                  } else {
                    setForm({ ...form, role: v as AppRole, perfilId: "" });
                  }
                }}
                options={opcoesPerfil}
                placeholder="Selecione"
                searchPlaceholder="Pesquisar perfil..."
              />
            </div>

            {/* Reabrir as telas da última sessão ao entrar */}
            <div className="space-y-2" data-ajuda="usuario-restaurar-sessao">
              <Label>Restaurar última sessão ao iniciar</Label>
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  checked={form.restaurarSessao}
                  onCheckedChange={(c) => setForm({ ...form, restaurarSessao: c })}
                />
                <span className="text-sm text-muted-foreground">
                  {form.restaurarSessao
                    ? "Reabre as telas e mosaicos da última vez"
                    : "Abre o sistema sem restaurar as telas"}
                </span>
              </div>
            </div>
          </div>

          {form.role !== "master" && form.role !== "admin" && (
            <div className="mt-4 space-y-4" data-ajuda="usuario-permissoes">
              <div>
                <p className="text-sm font-medium">Permissões deste usuário</p>
                <p className="text-xs text-muted-foreground">
                  {permsDoPerfil.length
                    ? "As marcadas em cinza vêm do perfil escolhido. Marque outras telas para liberar só para esta pessoa."
                    : "Escolha tela por tela o que esta pessoa pode ver e fazer."}
                </p>
              </div>
              <div className="space-y-4">
                {grupos.map((g) => {
                  const doGrupo = permsVisiveis.filter((p) => p.grupo === g);
                  return (
                    <div key={g} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <p className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {g}
                      </p>
                      <div className="flex flex-1 flex-nowrap items-center gap-x-6 gap-y-2 overflow-x-auto">
                        {doGrupo.map((p) => (
                          <label
                            key={p.value}
                            className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm"
                            title={permsDoPerfil.includes(p.value) ? "Vem do perfil" : undefined}
                          >
                            <Checkbox
                              disabled={permsDoPerfil.includes(p.value)}
                              checked={
                                permsDoPerfil.includes(p.value) ||
                                form.permissions.includes(p.value)
                              }
                              onCheckedChange={(c) =>
                                setForm({
                                  ...form,
                                  permissions: c
                                    ? [...form.permissions, p.value]
                                    : form.permissions.filter((x) => x !== p.value),
                                })
                              }
                            />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={
                salvar.isPending ||
                !form.nome ||
                (!form.id && (!form.email || form.senha.length < 6))
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
