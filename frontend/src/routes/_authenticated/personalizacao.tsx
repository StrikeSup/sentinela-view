import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useSettings } from "@/lib/settings-context";
import { useAuth } from "@/lib/auth";
import { defaultSettings, paletteToCss, splitNome, type AppSettings } from "@/lib/settings.functions";
import { PRESETS, PRESET_PADRAO, TOKENS, toHex, type Palette } from "@/lib/palettes";
import logoPadrao from "@/assets/logo-sentinela.png";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Upload, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/personalizacao")({
  head: () => ({
    meta: [
      { title: "Personalização — Sentinela VIEW" },
      { name: "description", content: "Nome, logos e paleta de cores do sistema." },
      { property: "og:title", content: "Personalização — Sentinela VIEW" },
      { property: "og:description", content: "Nome, logos e paleta de cores do sistema." },
    ],
  }),
  component: PersonalizacaoPage,
});

const MAX_IMG = 1024 * 1024; // 1 MB

function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    r.readAsDataURL(file);
  });
}

function CampoLogo({
  label,
  ajuda,
  value,
  onChange,
  disabled,
  tamanho,
  onTamanho,
}: {
  label: string;
  ajuda: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  tamanho?: number;
  onTamanho?: (v: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const isData = value.startsWith("data:");
  const enviar = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_IMG) { toast.error("Imagem muito grande (máx. 1 MB)"); return; }
    onChange(await lerArquivo(file));
  };
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-secondary">
          {value ? <img src={value} alt="" className="h-8 w-8 object-contain" /> : <span className="text-xs text-muted-foreground">—</span>}
        </div>
        <Input
          disabled={disabled}
          placeholder="https://..."
          value={isData ? "Imagem enviada" : value}
          readOnly={isData}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void enviar(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="icon" disabled={disabled} onClick={() => ref.current?.click()} aria-label="Enviar imagem">
          <Upload className="h-4 w-4" />
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onChange("")} aria-label="Remover">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {onTamanho && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Tamanho</span>
          <input
            type="range"
            min={20}
            max={96}
            step={2}
            disabled={disabled}
            value={tamanho ?? 36}
            onChange={(e) => onTamanho(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[var(--primary)]"
            aria-label={`Tamanho — ${label}`}
          />
          <span className="w-12 text-right font-mono text-xs text-muted-foreground">{tamanho ?? 36} px</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{ajuda}</p>
    </div>
  );
}

export function PersonalizacaoPage() {
  const { settings, setSettings } = useSettings();
  const { can } = useAuth();
  const router = useRouter();
  const podeEditar = can("personalizacao.editar");

  const [nome, setNome] = useState(settings.nome_sistema);
  const [destaque, setDestaque] = useState(settings.palavra_destaque ?? "");
  const [subtitulo, setSubtitulo] = useState(settings.subtitulo);
  const [loginTitulo, setLoginTitulo] = useState(settings.login_titulo);
  const [loginDestaque, setLoginDestaque] = useState(settings.login_titulo_destaque);
  const [loginSelo, setLoginSelo] = useState(settings.login_selo);
  const [logoMenu, setLogoMenu] = useState(settings.logo_url ?? "");
  const [logoCompacto, setLogoCompacto] = useState(settings.logo_compacto_url ?? "");
  const [logoLogin, setLogoLogin] = useState(settings.logo_login_url ?? "");
  const [favicon, setFavicon] = useState(settings.favicon_url ?? "");
  const [tamMenu, setTamMenu] = useState(settings.logo_tamanho_menu ?? 36);
  const [tamCompacto, setTamCompacto] = useState(settings.logo_tamanho_compacto ?? 36);
  const [tamLogin, setTamLogin] = useState(settings.logo_tamanho_login ?? 48);
  const [paleta, setPaleta] = useState(settings.paleta_nome || "verde");
  const [claro, setClaro] = useState<Palette>(
    Object.keys(settings.tema_claro ?? {}).length ? settings.tema_claro : PRESET_PADRAO.claro,
  );
  const [escuro, setEscuro] = useState<Palette>(
    Object.keys(settings.tema_escuro ?? {}).length ? settings.tema_escuro : PRESET_PADRAO.escuro,
  );

  const draft: AppSettings = {
    nome_sistema: nome,
    palavra_destaque: destaque || null,
    subtitulo,
    login_titulo: loginTitulo,
    login_titulo_destaque: loginDestaque,
    login_selo: loginSelo,
    logo_url: logoMenu || null,
    logo_compacto_url: logoCompacto || null,
    logo_login_url: logoLogin || null,
    favicon_url: favicon || null,
    logo_tamanho_menu: tamMenu,
    logo_tamanho_compacto: tamCompacto,
    logo_tamanho_login: tamLogin,
    paleta_nome: paleta,
    tema_claro: claro,
    tema_escuro: escuro,
  };

  const previewCss = useMemo(() => paletteToCss(draft), [claro, escuro]);

  const aplicarPreset = (nomePreset: string) => {
    const p = PRESETS.find((x) => x.nome === nomePreset);
    if (!p) return;
    setPaleta(p.nome);
    setClaro(p.claro);
    setEscuro(p.escuro);
  };

  const restaurar = () => {
    setNome(defaultSettings.nome_sistema);
    setDestaque(defaultSettings.palavra_destaque ?? "");
    setSubtitulo(defaultSettings.subtitulo);
    setLoginTitulo(defaultSettings.login_titulo);
    setLoginDestaque(defaultSettings.login_titulo_destaque);
    setLoginSelo(defaultSettings.login_selo);
    setLogoMenu("");
    setLogoCompacto("");
    setLogoLogin("");
    setFavicon("");
    setTamMenu(defaultSettings.logo_tamanho_menu);
    setTamCompacto(defaultSettings.logo_tamanho_compacto);
    setTamLogin(defaultSettings.logo_tamanho_login);
    aplicarPreset("verde");
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").update(draft).eq("id", true);
      if (error) throw error;
      return draft;
    },
    onSuccess: (payload) => {
      setSettings(payload);
      toast.success("Personalização salva");
      void router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editorCor = (titulo: string, palette: Palette, setPalette: (p: Palette) => void) => (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {TOKENS.map((t) => {
          const hex = toHex(palette[t.key]);
          return (
            <div key={t.key} className="space-y-1">
              <Label className="text-xs">{t.label}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  disabled={!podeEditar}
                  value={hex}
                  onChange={(e) => setPalette({ ...palette, [t.key]: e.target.value })}
                  className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                  aria-label={t.label}
                />
                <Input
                  disabled={!podeEditar}
                  value={palette[t.key] ?? ""}
                  onChange={(e) => setPalette({ ...palette, [t.key]: e.target.value })}
                  className="h-9 font-mono text-xs"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const [antes, dest, depois] = splitNome(nome, destaque || null);
  const logoPreview = logoMenu || logoPadrao;

  return (
    <div>
      {/* Pré-visualização ao vivo: sobrescreve os tokens enquanto edita */}
      <style dangerouslySetInnerHTML={{ __html: previewCss }} />

      <PageHeader
        title="Personalização"
        description="Nome, logos e cores — as mudanças aparecem na hora e são aplicadas a todos ao salvar."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do sistema</Label>
                <Input disabled={!podeEditar} value={nome} onChange={(e) => setNome(e.target.value)} />
                <p className="text-xs text-muted-foreground">Aparece no menu e na aba do navegador.</p>
              </div>
              <div className="space-y-2">
                <Label>Palavra em destaque</Label>
                <Input disabled={!podeEditar} value={destaque} onChange={(e) => setDestaque(e.target.value)} />
                <p className="text-xs text-muted-foreground">Parte do nome pintada com a cor principal (opcional).</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Subtítulo</Label>
                <Input disabled={!podeEditar} value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2 border-t pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Textos da tela de login
                </p>
              </div>
              <div className="space-y-2">
                <Label>Título da tela de login</Label>
                <Input
                  disabled={!podeEditar}
                  value={loginTitulo}
                  onChange={(e) => setLoginTitulo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Primeira linha, em branco.</p>
              </div>
              <div className="space-y-2">
                <Label>Segunda linha (colorida)</Label>
                <Input
                  disabled={!podeEditar}
                  value={loginDestaque}
                  onChange={(e) => setLoginDestaque(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Pintada com a cor principal.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Frase do selo</Label>
                <Input
                  disabled={!podeEditar}
                  value={loginSelo}
                  onChange={(e) => setLoginSelo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Texto pequeno ao lado do ponto pulsante.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <CampoLogo label="Logo do menu (aberto)" ajuda="Recomendado: PNG ou SVG quadrado de 512×512 px (ajuste o tamanho abaixo). Vazio usa o logo padrão." value={logoMenu} onChange={setLogoMenu} disabled={!podeEditar} tamanho={tamMenu} onTamanho={setTamMenu} />
              <CampoLogo label="Logo do menu recolhido" ajuda="Recomendado: PNG ou SVG quadrado de 512×512 px (ajuste o tamanho abaixo). Vazio usa o logo do menu." value={logoCompacto} onChange={setLogoCompacto} disabled={!podeEditar} tamanho={tamCompacto} onTamanho={setTamCompacto} />
              <CampoLogo label="Logo da tela de login" ajuda="Recomendado: PNG ou SVG quadrado de 512×512 px (ajuste o tamanho abaixo). Vazio usa o logo do menu." value={logoLogin} onChange={setLogoLogin} disabled={!podeEditar} tamanho={tamLogin} onTamanho={setTamLogin} />
              <CampoLogo label="Ícone da aba do navegador" ajuda="Recomendado: PNG quadrado de 64×64 px (exibido a 16 px)." value={favicon} onChange={setFavicon} disabled={!podeEditar} />
            </div>

            <div className="space-y-2">
              <Label>Paletas prontas</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.nome}
                    type="button"
                    disabled={!podeEditar}
                    onClick={() => aplicarPreset(p.nome)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50",
                      paleta === p.nome && "border-primary bg-accent ring-1 ring-primary",
                    )}
                  >
                    <span className="h-3 w-3 rounded-full" style={{ background: p.claro["primary"] }} />
                    <span className="h-3 w-3 rounded-full" style={{ background: p.escuro["primary"] }} />
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!podeEditar}
                  onClick={() => setPaleta("personalizada")}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50",
                    paleta === "personalizada" && "border-primary bg-accent ring-1 ring-primary",
                  )}
                >
                  <span className="h-3 w-3 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
                  Personalizada
                </button>
              </div>
            </div>

            {paleta === "personalizada" && (
              <div className="grid gap-6 lg:grid-cols-2">
                {editorCor("Tema claro", claro, (p) => setClaro(p))}
                {editorCor("Tema escuro", escuro, (p) => setEscuro(p))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => salvar.mutate()} disabled={!podeEditar || salvar.isPending}>
                Salvar personalização
              </Button>
              <Button variant="outline" onClick={restaurar} disabled={!podeEditar}>
                Restaurar padrão
              </Button>
            </div>
          </CardContent>
        </Card>





        <Card className="h-fit xl:sticky xl:top-20">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pré-visualização
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-md border bg-sidebar p-3">
              <img src={logoPreview} alt="" style={{ width: tamMenu, height: tamMenu }} className="object-contain" />
              <div className="min-w-0 leading-tight">
                <p className="truncate font-display font-bold">
                  {antes}
                  {dest && <span className="text-primary">{dest}</span>}
                  {depois}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{subtitulo}</p>
              </div>
            </div>
            <div className="rounded-md border bg-sidebar p-2">
              <div className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground">
                <LayoutDashboard className="h-4 w-4" /> Item ativo do menu
              </div>
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-sidebar-foreground/80">
                <LayoutDashboard className="h-4 w-4" /> Outro item
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Botão principal</Button>
              <Button size="sm" variant="secondary">Secundário</Button>
              <Button size="sm" variant="outline">Contorno</Button>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">Cartão de exemplo</p>
              <p className="text-xs text-muted-foreground">Texto secundário dentro do cartão.</p>
              <div className="mt-2 flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning" />
                <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              As cores mudam na hora só para você conferir. Clique em salvar para aplicar a todos.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
