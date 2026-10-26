import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BrandMark, BrandName } from "@/components/Brand";
import { useSettings } from "@/lib/settings-context";
import { Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — Sentinela VIEW" },
      { name: "description", content: "Acesse o painel de monitoramento Sentinela VIEW." },
      { property: "og:title", content: "Entrar — Sentinela VIEW" },
      { property: "og:description", content: "Acesse o painel de monitoramento Sentinela VIEW." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then((res) => {
      if (res.data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      toast.success("Bem-vindo de volta!");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível continuar";
      toast.error(msg.includes("Invalid login credentials") ? "E-mail ou senha incorretos" : msg);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0b0e14] p-4 text-white">
      {/* Fundo decorativo: grade de pontos + brilhos na cor principal */}
      <div className="pointer-events-none absolute inset-0 opacity-25">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle at 2px 2px, var(--primary) 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />
        <div
          className="absolute -left-20 top-1/4 h-96 w-96 rounded-full opacity-40 blur-[160px]"
          style={{ background: "var(--primary)" }}
        />
        <div
          className="absolute -right-20 bottom-1/4 h-96 w-96 rounded-full opacity-25 blur-[160px]"
          style={{ background: "var(--primary)" }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#10131a]/60 shadow-2xl backdrop-blur-xl lg:h-[85vh] lg:flex-row">
        {/* Lado esquerdo: identidade */}
        <div className="relative hidden flex-1 flex-col justify-between border-r border-white/5 p-14 lg:flex">
          <div className="flex items-center gap-3">
            {settings.logo_login_url ? (
              <BrandMark variant="login" />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl shadow-lg"
                style={{ background: "var(--primary)", boxShadow: "0 10px 30px -8px var(--primary)" }}
              >
                <BrandMark variant="compacto" className="brightness-0 invert" />
              </div>
            )}
            <p className="font-display text-xl font-bold uppercase tracking-tight">
              <BrandName />
            </p>
          </div>

          <div>
            <h1 className="font-display text-6xl font-extrabold leading-tight">
              {settings.login_titulo}
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(90deg, var(--primary), #67e8f9)" }}
              >
                {settings.login_titulo_destaque}
              </span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-white/50">{settings.subtitulo}</p>
          </div>

          <div className="flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3">
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: "var(--primary)" }}
            />
            <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
              {settings.login_selo}
            </span>
          </div>

          {/* Alvo técnico decorativo */}
          <div className="absolute bottom-12 right-12 opacity-10">
            <svg width="120" height="120" viewBox="0 0 100 100" className="fill-none stroke-current">
              <circle cx="50" cy="50" r="45" strokeDasharray="10 5" />
              <circle cx="50" cy="50" r="30" />
              <path d="M50 5 L50 95 M5 50 L95 50" />
            </svg>
          </div>
        </div>

        {/* Lado direito: formulário */}
        <div className="flex w-full flex-col justify-center bg-white/5 p-8 lg:w-[480px] lg:p-14">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <BrandMark variant="login" />
            <h1 className="font-display text-xl font-bold">
              <BrandName />
            </h1>
          </div>

          <div className="mb-8 text-center lg:text-left">
            <h2 className="font-display text-3xl font-bold">Entrar no sistema</h2>
            <p className="mt-2 text-sm text-white/50">
              Identifique-se para acessar o painel central.
            </p>
          </div>

          <form onSubmit={enviar} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="ml-1 text-sm font-semibold text-white/70">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nome@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 rounded-xl border-white/10 bg-white/5 px-5 text-white placeholder:text-white/25 focus-visible:ring-2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha" className="ml-1 text-sm font-semibold text-white/70">
                Senha
              </Label>
              <div className="relative">
                <Input
                  id="senha"
                  type={mostrarSenha ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  minLength={6}
                  required
                  className="h-12 rounded-xl border-white/10 bg-white/5 px-5 pr-12 text-white placeholder:text-white/25 focus-visible:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/80"
                  tabIndex={-1}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                >
                  {mostrarSenha ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={carregando}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-display text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-60"
              style={{
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                boxShadow: "0 10px 30px -10px var(--primary)",
              }}
            >
              {carregando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>Acessar painel</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
