import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "master" | "admin" | "operador" | "visualizador";
export type AppPermission =
  | "dashboard.ver"
  | "clientes.ver"
  | "servidores.ver"
  | "dvrs.ver"
  | "visualizacao.ver"
  | "mosaicos.ver"
  | "ronda.ver"
  | "monitoramento.ver"
  | "discos.ver"
  | "discos.editar"
  | "importacoes.ver"
  | "importacoes.criar"
  | "mosaicos.criar"
  | "mosaicos.editar"
  | "mosaicos.excluir"
  | "ronda.criar"
  | "ronda.editar"
  | "ronda.excluir"
  | "deteccao.ver"
  | "deteccao.editar"
  | "diagnostico.ver"
  | "downloads.ver"
  | "ajuda.ver"


  | "usuarios.ver"
  | "log.ver"
  | "personalizacao.ver"
  | "clientes.criar"
  | "clientes.editar"
  | "clientes.excluir"
  | "servidores.criar"
  | "servidores.editar"
  | "servidores.excluir"
  | "dvrs.criar"
  | "dvrs.editar"
  | "dvrs.excluir"
  | "usuarios.criar"
  | "usuarios.editar"
  | "usuarios.excluir"
  | "gravacoes.ver"
  | "relatorios.ver"
  | "personalizacao.editar";

export const PERMISSOES: { value: AppPermission; label: string; grupo: string }[] = [
  { value: "dashboard.ver", label: "Visualizar", grupo: "Início" },
  { value: "clientes.ver", label: "Visualizar", grupo: "Clientes" },
  { value: "servidores.ver", label: "Visualizar", grupo: "Servidores" },
  { value: "servidores.criar", label: "Criar", grupo: "Servidores" },
  { value: "servidores.editar", label: "Editar", grupo: "Servidores" },
  { value: "servidores.excluir", label: "Excluir", grupo: "Servidores" },
  { value: "discos.ver", label: "Visualizar", grupo: "Discos" },
  { value: "discos.editar", label: "Editar", grupo: "Discos" },
  { value: "dvrs.ver", label: "Visualizar", grupo: "DVRs" },
  { value: "dvrs.criar", label: "Criar", grupo: "DVRs" },
  { value: "dvrs.editar", label: "Editar", grupo: "DVRs" },
  { value: "dvrs.excluir", label: "Excluir", grupo: "DVRs" },
  { value: "visualizacao.ver", label: "Visualizar", grupo: "Visualização" },
  { value: "monitoramento.ver", label: "Visualizar", grupo: "Gerenciamento de telas" },
  { value: "mosaicos.ver", label: "Visualizar", grupo: "Mosaicos" },
  { value: "mosaicos.criar", label: "Criar", grupo: "Mosaicos" },
  { value: "mosaicos.editar", label: "Editar", grupo: "Mosaicos" },
  { value: "mosaicos.excluir", label: "Excluir", grupo: "Mosaicos" },
  { value: "ronda.ver", label: "Visualizar", grupo: "Ronda" },
  { value: "ronda.criar", label: "Criar", grupo: "Ronda" },
  { value: "ronda.editar", label: "Editar", grupo: "Ronda" },
  { value: "ronda.excluir", label: "Excluir", grupo: "Ronda" },
  { value: "deteccao.ver", label: "Visualizar", grupo: "Detecção" },
  { value: "deteccao.editar", label: "Editar", grupo: "Detecção" },
  { value: "gravacoes.ver", label: "Visualizar", grupo: "Reprodução" },
  { value: "importacoes.ver", label: "Visualizar", grupo: "Importações" },
  { value: "importacoes.criar", label: "Importar", grupo: "Importações" },
  { value: "relatorios.ver", label: "Visualizar", grupo: "Relatórios" },
  { value: "log.ver", label: "Visualizar", grupo: "Logs" },
  { value: "usuarios.ver", label: "Visualizar", grupo: "Usuários" },
  { value: "usuarios.criar", label: "Criar", grupo: "Usuários" },
  { value: "usuarios.editar", label: "Editar", grupo: "Usuários" },
  { value: "usuarios.excluir", label: "Excluir", grupo: "Usuários" },
  { value: "ajuda.ver", label: "Visualizar", grupo: "Central de ajuda" },
  { value: "downloads.ver", label: "Visualizar", grupo: "Downloads" },
  { value: "personalizacao.ver", label: "Visualizar", grupo: "Personalização" },
  { value: "personalizacao.editar", label: "Editar", grupo: "Personalização" },
  { value: "diagnostico.ver", label: "Visualizar", grupo: "Diagnóstico WebRTC" },
];


type Profile = {
  id: string;
  nome: string;
  email: string;
  avatar_url: string | null;
  perfil_id?: string | null;
  restaurar_sessao?: boolean | null;
};

/** Perfil personalizado, criado para um cliente específico. */
export type PerfilPersonalizado = {
  id: string;
  cliente_id: string;
  nome: string;
  descricao: string | null;
  base_role: AppRole;
  permissions: AppPermission[];
};

type AuthValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  permissions: AppPermission[];
  /** null = acesso a todos os clientes; string[] = restrito a estes */
  clienteIds: string[] | null;
  /** Perfil personalizado vinculado ao usuário (quando houver). */
  perfil: PerfilPersonalizado | null;
  loading: boolean;
  /** Mensagem quando não foi possível carregar perfil/permissões. */
  erroAcesso: string | null;
  isMaster: boolean;
  isAdmin: boolean;
  can: (perm: AppPermission) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

// Mantém o mesmo contexto entre recarregamentos a quente (HMR),
// evitando "useAuth deve ser usado dentro de AuthProvider".
const globalRef = globalThis as unknown as {
  __sentinelaAuthContext?: React.Context<AuthValue | null>;
};
const AuthContext =
  globalRef.__sentinelaAuthContext ??
  (globalRef.__sentinelaAuthContext = createContext<AuthValue | null>(null));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<AppPermission[]>([]);
  const [clienteIds, setClienteIds] = useState<string[] | null>(null);
  const [perfil, setPerfil] = useState<PerfilPersonalizado | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);
  const carregando = useRef(false);
  const precisaCarregar = useRef(true);

  /** Uma tentativa de carregar perfil, papel, permissões e clientes. */
  const buscarAcesso = async (userId: string) => {
    const [profR, rolesR, permsR, uclisR] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nome, email, avatar_url, perfil_id, restaurar_sessao")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_permissions").select("permission").eq("user_id", userId),
      supabase.from("user_clientes").select("cliente_id").eq("user_id", userId),
    ]);
    const falha = profR.error ?? rolesR.error ?? permsR.error ?? uclisR.error;
    if (falha) throw new Error(falha.message);
    const prof = profR.data;
    const ordem: AppRole[] = ["master", "admin", "operador", "visualizador"];
    const found = (rolesR.data ?? [])
      .map((r) => r.role as AppRole)
      .sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    const r = found[0] ?? null;
    // Perfil personalizado: soma as permissões definidas nele.
    let perfilAtual: PerfilPersonalizado | null = null;
    const perfilId = (prof as { perfil_id?: string | null } | null)?.perfil_id ?? null;
    if (perfilId) {
      const pfR = await supabase
        .from("perfis")
        .select("id, cliente_id, nome, descricao, base_role, permissions")
        .eq("id", perfilId)
        .maybeSingle();
      if (pfR.error) throw new Error(pfR.error.message);
      if (pfR.data) perfilAtual = pfR.data as unknown as PerfilPersonalizado;
    }
    const proprias = (permsR.data ?? []).map((p) => p.permission as AppPermission);
    const doPerfil = perfilAtual?.permissions ?? [];
    const ids = (uclisR.data ?? []).map((c) => c.cliente_id);
    return {
      profile: (prof as unknown as Profile) ?? null,
      role: r,
      perfil: perfilAtual,
      permissions: Array.from(new Set([...proprias, ...doPerfil])),
      // master/admin veem todos os clientes; demais veem apenas os vinculados
      // (sem vínculos = todos, para compatibilidade)
      clienteIds: r === "master" || r === "admin" || ids.length === 0 ? null : ids,
    };
  };

  const loadUserData = async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setRole(null);
      setPermissions([]);
      setClienteIds(null);
      setPerfil(null);
      setErroAcesso(null);
      precisaCarregar.current = true;
      return;
    }
    if (carregando.current) return;
    carregando.current = true;
    const esperas = [400, 1200, 3000];
    try {
      for (let tentativa = 0; ; tentativa++) {
        try {
          const dados = await buscarAcesso(userId);
          setProfile(dados.profile);
          setRole(dados.role);
          setPerfil(dados.perfil);
          setPermissions(dados.permissions);
          setClienteIds(dados.clienteIds);
          setErroAcesso(null);
          precisaCarregar.current = false;
          return;
        } catch (e) {
          const espera = esperas[tentativa];
          if (espera === undefined) {
            // Falhou: mantém o que já havia carregado, sem zerar o acesso.
            setErroAcesso(e instanceof Error ? e.message : "Falha ao carregar o acesso");
            return;
          }
          await new Promise((r) => setTimeout(r, espera));
        }
      }
    } finally {
      carregando.current = false;
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "INITIAL_SESSION") return;
      setTimeout(() => {
        void loadUserData(newSession?.user?.id);
      }, 0);
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadUserData(data.session?.user?.id);
      setLoading(false);
    });

    // Recupera sozinho quando a janela volta ao foco ou a internet retorna,
    // apenas se o acesso ainda não tiver sido carregado.
    const retomar = () => {
      if (!precisaCarregar.current) return;
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user?.id) void loadUserData(data.session.user.id);
      });
    };
    window.addEventListener("focus", retomar);
    window.addEventListener("online", retomar);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", retomar);
      window.removeEventListener("online", retomar);
    };
  }, []);

  const value = useMemo<AuthValue>(() => {
    const isMaster = role === "master";
    const isAdmin = role === "master" || role === "admin";
    return {
      session,
      user: session?.user ?? null,
      profile,
      role,
      permissions,
      clienteIds,
      perfil,
      loading,
      erroAcesso,
      isMaster,
      isAdmin,
      can: (perm) => isAdmin || permissions.includes(perm),
      refresh: async () => loadUserData(session?.user?.id),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, profile, role, permissions, clienteIds, perfil, loading, erroAcesso]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
