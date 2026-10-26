export type Palette = Record<string, string>;

/** Tokens editáveis na tela de personalização (valores em hex). */
export const TOKENS: { key: string; label: string }[] = [
  { key: "background", label: "Fundo" },
  { key: "foreground", label: "Texto" },
  { key: "card", label: "Cartão" },
  { key: "primary", label: "Cor principal" },
  { key: "primary-foreground", label: "Texto sobre principal" },
  { key: "secondary", label: "Secundária" },
  { key: "accent", label: "Destaque" },
  { key: "muted-foreground", label: "Texto secundário" },
  { key: "border", label: "Borda" },
  { key: "sidebar", label: "Menu lateral" },
  { key: "sidebar-accent", label: "Item ativo do menu" },
  { key: "success", label: "Sucesso" },
  { key: "warning", label: "Aviso" },
  { key: "destructive", label: "Erro" },
];

const baseClaro: Palette = {
  background: "#f7f7f8",
  foreground: "#131417",
  card: "#ffffff",
  "primary-foreground": "#ffffff",
  secondary: "#f0f1f3",
  "muted-foreground": "#6b7280",
  border: "#e4e5e8",
  sidebar: "#fbfbfc",
  "sidebar-accent": "#eef0f2",
  success: "#16a34a",
  warning: "#f59e0b",
  destructive: "#dc2626",
};

const baseEscuro: Palette = {
  background: "#0b0c0f",
  foreground: "#f2f3f5",
  card: "#121317",
  "primary-foreground": "#0b0c0f",
  secondary: "#1a1b20",
  "muted-foreground": "#9a9ea7",
  border: "#26272d",
  sidebar: "#0e0f12",
  "sidebar-accent": "#1a1b20",
  success: "#22c55e",
  warning: "#fbbf24",
  destructive: "#ef4444",
};

export type PresetName =
  | "violeta"
  | "azul"
  | "verde"
  | "ambar"
  | "vermelho"
  | "ciano"
  | "rosa"
  | "grafite";

export type Preset = {
  nome: PresetName;
  label: string;
  claro: Palette;
  escuro: Palette;
};

function preset(
  nome: PresetName,
  label: string,
  c: { primary: string; accent: string; fg?: string },
  e: { primary: string; accent: string; fg?: string },
): Preset {
  return {
    nome,
    label,
    claro: { ...baseClaro, primary: c.primary, accent: c.accent, "primary-foreground": c.fg ?? "#ffffff" },
    escuro: { ...baseEscuro, primary: e.primary, accent: e.accent, "primary-foreground": e.fg ?? "#0b0c0f" },
  };
}

export const PRESETS: Preset[] = [
  preset("violeta", "Violeta", { primary: "#7c3aed", accent: "#ede9fe" }, { primary: "#a78bfa", accent: "#2a1f4d" }),
  preset("azul", "Azul", { primary: "#2563eb", accent: "#dbeafe" }, { primary: "#60a5fa", accent: "#1a2846" }),
  preset("verde", "Verde", { primary: "#16a34a", accent: "#dcfce7" }, { primary: "#22c55e", accent: "#143220" }),
  preset("ambar", "Âmbar", { primary: "#f59e0b", accent: "#fef3c7", fg: "#1a1200" }, { primary: "#fbbf24", accent: "#3a2a0a" }),
  preset("vermelho", "Vermelho", { primary: "#dc2626", accent: "#fee2e2" }, { primary: "#f87171", accent: "#3a1616" }),
  preset("ciano", "Ciano", { primary: "#0891b2", accent: "#cffafe" }, { primary: "#22d3ee", accent: "#0c2f38" }),
  preset("rosa", "Rosa", { primary: "#db2777", accent: "#fce7f3" }, { primary: "#f472b6", accent: "#3a1430" }),
  preset("grafite", "Grafite", { primary: "#374151", accent: "#e5e7eb" }, { primary: "#d1d5db", accent: "#2a2d33" }),
];

export const PRESET_PADRAO = PRESETS.find((p) => p.nome === "verde")!;

/** Expande os tokens editáveis para o conjunto completo usado pelo design system. */
export function expandPalette(p: Palette): Palette {
  if (!p || Object.keys(p).length === 0) return {};
  const out: Palette = { ...p };
  const set = (k: string, v: string | undefined) => {
    if (v && !out[k]) out[k] = v;
  };
  set("card-foreground", p["foreground"]);
  set("popover", p["card"]);
  set("popover-foreground", p["foreground"]);
  set("secondary-foreground", p["foreground"]);
  set("muted", p["secondary"]);
  set("accent-foreground", p["foreground"]);
  set("input", p["border"]);
  set("ring", p["primary"]);
  set("sidebar-foreground", p["foreground"]);
  set("sidebar-primary", p["primary"]);
  set("sidebar-primary-foreground", p["primary-foreground"]);
  set("sidebar-accent-foreground", p["foreground"]);
  set("sidebar-border", p["border"]);
  set("sidebar-ring", p["primary"]);
  set("chart-1", p["primary"]);
  set("success-foreground", p["primary-foreground"]);
  set("warning-foreground", "#1a1200");
  set("destructive-foreground", "#ffffff");
  return out;
}

/* ---------- conversão de cores ---------- */

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

function linToSrgb(c: number) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp01(v) * 255);
}

/** Converte "oklch(L C H)" para hex. Retorna null se não reconhecer. */
export function oklchToHex(input: string): string | null {
  const m = input.trim().match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return null;
  let L = parseFloat(m[1]!);
  if (input.includes("%")) L /= 100;
  const C = parseFloat(m[2]!);
  const H = (parseFloat(m[3]!) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const hex = (n: number) => linToSrgb(n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bb)}`;
}

/** Normaliza qualquer valor salvo para hex de 6 dígitos (para o seletor de cor). */
export function toHex(value: string | undefined, fallback = "#000000"): string {
  if (!value) return fallback;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return oklchToHex(v) ?? fallback;
}
