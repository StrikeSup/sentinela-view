import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { ClienteProvider } from "@/lib/cliente-context";
import { PresencaProvider } from "@/lib/presenca";
import {
  emTelaExtra,
  atenderPedidosDeSessao,
  pedirSessaoAoPai,
  avisarSaida,
  ouvirSaida,
  ouvirFechamentoDeTela,
  removerTela,
  removerTelaRemota,
  registrarPrincipalViva,
  vigiarPrincipal,
} from "@/lib/telas-extras";
import { RestaurarTelas } from "@/components/RestaurarTelas";
import { BotaoAjuda } from "@/components/BotaoAjuda";
import { limparTelasRestauradas } from "@/lib/permissoes";
import { useEffect, useRef } from "react";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Sessão local (sem ida à rede): deixa a tela extra abrir quase na hora.
    const local = await supabase.auth.getSession();
    if (local.data.session?.user) return { user: local.data.session.user };
    let { data, error } = await supabase.auth.getUser();
    // Tela extra (janela separada): herda a sessão de quem a abriu,
    // sem pedir login novamente.
    if ((error || !data.user) && emTelaExtra()) {
      const tokens = await pedirSessaoAoPai();
      if (tokens) {
        await supabase.auth.setSession(tokens);
        const novo = await supabase.auth.getUser();
        data = novo.data;
        error = novo.error;
      }
    }
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppLayout,
});

const ROLE_LABEL: Record<string, string> = {
  master: "Master",
  admin: "Administrador",
  operador: "Operador",
  visualizador: "Visualizador",
};

function AppLayout() {
  const { theme, setTheme } = useTheme();
  const { profile, role, session, user, loading, erroAcesso, refresh } = useAuth();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sair = async () => {
    avisarSaida();
    limparTelasRestauradas();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const janelaExtra = emTelaExtra();

  // Janela principal: entrega a sessão às telas extras que pedirem.
  useEffect(() => {
    if (janelaExtra) return;
    return atenderPedidosDeSessao(() => {
      const s = sessionRef.current;
      return s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null;
    });
  }, [janelaExtra]);

  // Janela principal: publica sinal de vida para as telas extras.
  useEffect(() => {
    if (janelaExtra) return;
    return registrarPrincipalViva();
  }, [janelaExtra]);

  // Só apaga a memória quando uma janela foi realmente fechada. Recarregar a
  // tela volta a publicar presença; sair da conta preserva a configuração.
  useEffect(() => {
    if (janelaExtra || !user?.id) return;
    return ouvirFechamentoDeTela((id) => {
      removerTela(id);
      void removerTelaRemota(user.id, id);
      // garantia: se a janela extra não conseguiu avisar ao fechar, a
      // principal tira a linha dela do Monitoramento
      void supabase
        .from("sessoes_usuario")
        .delete()
        .eq("user_id", user.id)
        .eq("sessao", `tela-${id}`);
    });
  }, [janelaExtra, user?.id]);

  // Tela extra: fecha junto quando o usuário sai ou fecha a janela principal.
  useEffect(() => {
    if (!janelaExtra) return;
    const fechar = () => {
      // Não chama signOut aqui: a sessão fica no armazenamento compartilhado
      // e isso derrubaria também a janela principal.
      window.close();
      // se o navegador não deixar fechar, ao menos sai da conta nesta tela
      setTimeout(() => {
        if (!window.closed) window.location.replace("/auth");
      }, 300);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") fechar();
    });
    const pararSaida = ouvirSaida(fechar);
    // a principal publica presença contínua; sem sinal, ela foi fechada
    const pararVigia = vigiarPrincipal(fechar);
    const t = setInterval(() => {
      if (window.opener && window.opener.closed) fechar();
    }, 2000);
    return () => {
      sub.subscription.unsubscribe();
      pararSaida();
      pararVigia();
      clearInterval(t);
    };
  }, [janelaExtra]);

  const iniciais = (profile?.nome || profile?.email || "U").slice(0, 2).toUpperCase();

  // Enquanto o acesso (perfil, papel e permissões) não chega, não mostra um
  // menu vazio: segue no carregamento.
  if (loading && !role) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando seu acesso…</p>
      </div>
    );
  }

  // Falhou mesmo após novas tentativas: avisa em vez de parecer falta de acesso.
  if (erroAcesso && !role && !emTelaExtra()) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-base font-medium">Não foi possível carregar seu acesso</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Verifique sua conexão e tente novamente. Seus dados não foram alterados.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void refresh()}>Tentar novamente</Button>
          <Button variant="outline" onClick={() => void sair()}>
            Sair
          </Button>
        </div>
      </div>
    );
  }

  // janela extra de visualização: sem menu nem cabeçalho, só o mosaico
  if (emTelaExtra()) {
    return (
      <ClienteProvider>
        <PresencaProvider>
          <div className="min-h-screen w-full bg-background">
            <Outlet />
          </div>
        </PresencaProvider>
      </ClienteProvider>
    );
  }

  return (
    <ClienteProvider>
      <PresencaProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
              <div className="ml-auto flex items-center gap-1">
                <BotaoAjuda />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Alternar tema"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="gap-2 px-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="bg-primary/15 text-xs text-primary">
                          {iniciais}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden text-sm sm:inline">{profile?.nome || "Usuário"}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <p className="text-sm font-medium">{profile?.nome}</p>
                      <p className="text-xs font-normal text-muted-foreground">{profile?.email}</p>
                      <p className="mt-1 text-xs font-normal text-primary">
                        {role ? ROLE_LABEL[role] : ""}
                      </p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={sair}>
                      <LogOut className="mr-2 h-4 w-4" /> Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            <main className="page-enter min-w-0 flex-1 p-4 md:p-6">
              <Outlet />
            </main>
            <RestaurarTelas />
          </div>
        </div>
      </SidebarProvider>
      </PresencaProvider>
    </ClienteProvider>
  );
}
