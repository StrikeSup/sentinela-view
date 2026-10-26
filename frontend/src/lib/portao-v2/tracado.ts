/**
 * Portão 2.0 — traçado das grades para a prévia na câmera.
 * O 1.0 aceita no máximo 14 colunas entre barras; com contorno menor o passo cresce
 * e a sequência é cortada no meio. Aqui o limite acompanha o passo real
 * (mediana dos espaços entre picos, ou o passo aprendido nas fotos Fechado).
 */
import { ALT_GRADES, LARG_GRADES, melhorSequencia, perfilColunas, picos } from "@/lib/portao-grades";

export function espacoMaxV2(xs: number[], passo?: number | null): number {
  if (passo && passo > 0) return Math.max(14, Math.ceil(passo * 1.6));
  const d = xs.slice(1).map((x, i) => x - (xs[i] ?? 0)).filter((v) => v >= 2).sort((a, b) => a - b);
  if (d.length < 3) return 14;
  const med = d[Math.floor(d.length / 2)] ?? 14;
  return Math.max(14, Math.ceil(med * 1.6));
}

export function barrasV2(v: Float32Array, passo?: number | null, larg = LARG_GRADES, alt = ALT_GRADES): number[] {
  const xs = picos(perfilColunas(v, larg, alt));
  return melhorSequencia(xs, espacoMaxV2(xs, passo));
}
