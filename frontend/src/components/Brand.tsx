import logo from "@/assets/logo-sentinela.png";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings-context";
import { splitNome } from "@/lib/settings.functions";

type Variant = "menu" | "compacto" | "login";

export function BrandMark({ className, variant = "menu", sizeOverride }: { className?: string; variant?: Variant; sizeOverride?: number }) {
  const { settings } = useSettings();
  const src =
    (variant === "compacto" && settings.logo_compacto_url) ||
    (variant === "login" && settings.logo_login_url) ||
    settings.logo_url ||
    logo;
  const baseSize =
    variant === "compacto"
      ? settings.logo_tamanho_compacto
      : variant === "login"
        ? settings.logo_tamanho_login
        : settings.logo_tamanho_menu;
  const size = sizeOverride ?? baseSize;
  return (
    <img
      src={src}
      alt={settings.nome_sistema}
      data-sentinela-app-icon={settings.logo_url || logo}
      style={{ width: size, height: size }}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function BrandName({ className }: { className?: string }) {
  const { settings } = useSettings();
  const [antes, destaque, depois] = splitNome(settings.nome_sistema, settings.palavra_destaque);
  return (
    <span className={className}>
      {antes}
      {destaque && <span className="text-primary">{destaque}</span>}
      {depois}
    </span>
  );
}

export function BrandLockup({ compact = false, compactSize }: { compact?: boolean; compactSize?: number }) {
  const { settings } = useSettings();
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <BrandMark variant={compact ? "compacto" : "menu"} {...(compact && compactSize != null ? { sizeOverride: compactSize } : {})} />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-base font-bold tracking-tight">
            <BrandName />
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{settings.subtitulo}</p>
        </div>
      )}
    </div>
  );
}
