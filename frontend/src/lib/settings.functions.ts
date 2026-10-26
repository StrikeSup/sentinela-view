import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { expandPalette, type Palette } from "./palettes";

export type { Palette };

export type AppSettings = {
  nome_sistema: string;
  palavra_destaque: string | null;
  subtitulo: string;
  login_titulo: string;
  login_titulo_destaque: string;
  login_selo: string;
  logo_url: string | null;
  logo_compacto_url: string | null;
  logo_login_url: string | null;
  favicon_url: string | null;
  logo_tamanho_menu: number;
  logo_tamanho_compacto: number;
  logo_tamanho_login: number;
  paleta_nome: string;
  tema_claro: Palette;
  tema_escuro: Palette;
};

export const defaultSettings: AppSettings = {
  nome_sistema: "Sentinela VIEW",
  palavra_destaque: "VIEW",
  subtitulo: "Monitoramento em tempo real",
  login_titulo: "Vigilância",
  login_titulo_destaque: "Inteligente.",
  login_selo: "Acesso restrito a usuários autorizados",
  logo_url: null,
  logo_compacto_url: null,
  logo_login_url: null,
  favicon_url: null,
  logo_tamanho_menu: 36,
  logo_tamanho_compacto: 36,
  logo_tamanho_login: 48,
  paleta_nome: "verde",
  tema_claro: {},
  tema_escuro: {},
};

export const getAppSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppSettings> => {
    const { supabaseUrlServidor, supabasePublishableKeyServidor } = await import(
      "@/integrations/supabase/config.server"
    );
    const url = supabaseUrlServidor();
    const key = supabasePublishableKeyServidor();
    if (!url || !key) return defaultSettings;

    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });

    const { data } = await client
      .from("app_settings")
      .select(
        "nome_sistema, palavra_destaque, subtitulo, login_titulo, login_titulo_destaque, login_selo, logo_url, logo_compacto_url, logo_login_url, favicon_url, logo_tamanho_menu, logo_tamanho_compacto, logo_tamanho_login, paleta_nome, tema_claro, tema_escuro",
      )
      .maybeSingle();

    if (!data) return defaultSettings;
    return {
      nome_sistema: data.nome_sistema,
      palavra_destaque: data.palavra_destaque,
      subtitulo: data.subtitulo,
      login_titulo: data.login_titulo,
      login_titulo_destaque: data.login_titulo_destaque,
      login_selo: data.login_selo,
      logo_url: data.logo_url,
      logo_compacto_url: data.logo_compacto_url,
      logo_login_url: data.logo_login_url,
      favicon_url: data.favicon_url,
      logo_tamanho_menu: data.logo_tamanho_menu ?? 36,
      logo_tamanho_compacto: data.logo_tamanho_compacto ?? 36,
      logo_tamanho_login: data.logo_tamanho_login ?? 48,
      paleta_nome: data.paleta_nome,
      tema_claro: (data.tema_claro ?? {}) as Palette,
      tema_escuro: (data.tema_escuro ?? {}) as Palette,
    };
  },
);

export function paletteToCss(settings: Pick<AppSettings, "tema_claro" | "tema_escuro">): string {
  const toBlock = (palette: Palette) =>
    Object.entries(expandPalette(palette))
      .map(([k, v]) => `--${k}: ${v};`)
      .join("");
  const light = toBlock(settings.tema_claro);
  const dark = toBlock(settings.tema_escuro);
  return `${light ? `:root{${light}}` : ""}${dark ? `.dark{${dark}}` : ""}`;
}

/** Divide o nome do sistema em [antes, destaque, depois] conforme a palavra em destaque. */
export function splitNome(nome: string, destaque: string | null): [string, string, string] {
  const d = (destaque ?? "").trim();
  if (!d) return [nome, "", ""];
  const idx = nome.toLowerCase().indexOf(d.toLowerCase());
  // Se a palavra não faz parte do nome, ela é acrescentada ao final em destaque
  if (idx < 0) return [`${nome.trimEnd()} `, d, ""];
  return [nome.slice(0, idx), nome.slice(idx, idx + d.length), nome.slice(idx + d.length)];
}
