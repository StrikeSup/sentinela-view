/**
 * Portão 2.0 — referências com metadados explícitos.
 * Nunca deduz pelo tamanho da imagem se ela é quadro completo ou recorte:
 * a origem é declarada. Referência de EVENTO (quadro completo) é recortada pela ROI
 * cadastrada antes de ser usada. Referências antigas (texto) são preservadas como "legado".
 */
import type { RoiPortao } from "../portao-area";

export type OrigemRefV2 = "captura" | "evento" | "legado";
export type ReferenciaV2 = {
  src: string;
  origem: OrigemRefV2;
  /** true = já está no recorte da ROI; false = quadro completo; null = desconhecido (legado). */
  recortada: boolean | null;
  roi?: Pick<RoiPortao, "x" | "y" | "w" | "h">;
};

export type Retangulo = { sx: number; sy: number; sw: number; sh: number };

const ok01 = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** Valida a ROI normalizada (0..1, área positiva, dentro do quadro). */
export function roiValida(roi: unknown): roi is Pick<RoiPortao, "x" | "y" | "w" | "h"> {
  const r = roi as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
  if (!r || !ok01(r.x) || !ok01(r.y) || !ok01(r.w) || !ok01(r.h)) return false;
  const { x, y, w, h } = r as { x: number; y: number; w: number; h: number };
  return w > 0 && h > 0 && x + w <= 1 + 1e-6 && y + h <= 1 + 1e-6;
}

/** Retângulo em pixels do quadro completo para recortar a ROI. Null se dimensões/ROI inválidas ou recorte < 8 px. */
export function retanguloRecorte(largura: number, altura: number, roi: unknown): Retangulo | null {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura <= 0 || altura <= 0) return null;
  if (!roiValida(roi)) return null;
  const sx = Math.round(roi.x * largura), sy = Math.round(roi.y * altura);
  const sw = Math.min(largura - sx, Math.round(roi.w * largura)), sh = Math.min(altura - sy, Math.round(roi.h * altura));
  if (sw < 8 || sh < 8) return null;
  return { sx, sy, sw, sh };
}

/** Aceita data URL de imagem ou URL http(s). */
export function srcValido(src: unknown): src is string {
  return typeof src === "string" && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || /^https?:\/\/\S+$/.test(src));
}

/** Normaliza o que veio do banco: texto antigo vira "legado" (preservado, sem reescrever). Inválidos são descartados. */
export function normalizarReferenciaV2(item: unknown): ReferenciaV2 | null {
  if (typeof item === "string") return srcValido(item) ? { src: item, origem: "legado", recortada: null } : null;
  const r = item as Partial<ReferenciaV2> | null;
  if (!r || !srcValido(r.src) || !["captura", "evento", "legado"].includes(r.origem as string)) return null;
  if (r.recortada !== true && r.recortada !== false && r.recortada !== null) return null;
  return { src: r.src, origem: r.origem!, recortada: r.recortada, ...(r.roi ? { roi: r.roi } : {}) };
}

/**
 * Como usar a referência na leitura atual:
 * - recortada true ou legado (capturas da tela do 2.0 sempre foram recortadas): usa direto;
 * - quadro completo (evento): recorta pela ROI informada, senão pela ROI atual da câmera.
 */
export function planoDeUso(ref: ReferenciaV2, roiCamera: unknown): { recortar: false } | { recortar: true; roi: Pick<RoiPortao, "x" | "y" | "w" | "h"> } | null {
  if (ref.recortada === true || (ref.origem !== "evento" && ref.recortada === null)) return { recortar: false };
  const roi = ref.roi ?? roiCamera;
  return roiValida(roi) ? { recortar: true, roi } : null;
}
