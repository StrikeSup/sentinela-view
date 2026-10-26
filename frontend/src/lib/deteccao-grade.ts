/**
 * Grade padrão da detecção de movimento (tela Detecção, editor compacto e Agent).
 * Registros antigos podem ter sido salvos em outra grade (ex.: 22x18); a
 * máscara é remapeada por área para 32x24 antes de mostrar, editar ou enviar.
 */
export const GRADE_COLUNAS = 32;
export const GRADE_LINHAS = 24;
/** Grade usada pelos registros antigos quando colunas/linhas estão ausentes. */
export const GRADE_LEGADA_COLUNAS = 22;
export const GRADE_LEGADA_LINHAS = 18;

/**
 * Remapeia índices ignorados (linha * colunas + coluna) de uma grade de origem
 * para a grade de destino. A célula de destino fica ignorada quando pelo menos
 * metade da sua área está coberta por células ignoradas da origem.
 * Retorna índices únicos em ordem crescente.
 */
export function remapearIgnorados(
  ignorados: readonly number[],
  origemColunas: number,
  origemLinhas: number,
  destinoColunas = GRADE_COLUNAS,
  destinoLinhas = GRADE_LINHAS,
): number[] {
  const totalOrigem = origemColunas * origemLinhas;
  const set = new Set<number>();
  for (const n of ignorados) if (Number.isInteger(n) && n >= 0 && n < totalOrigem) set.add(n);
  if (origemColunas === destinoColunas && origemLinhas === destinoLinhas) {
    return [...set].sort((a, b) => a - b);
  }
  if (set.size === 0) return [];

  // Sobreposição 1D: fração de [a0,a1) coberta por cada célula de origem.
  const sobreposicao = (i: number, nDest: number, nOrig: number) => {
    const a0 = i / nDest;
    const a1 = (i + 1) / nDest;
    const saida: Array<[number, number]> = [];
    const j0 = Math.floor(a0 * nOrig);
    const j1 = Math.min(nOrig - 1, Math.ceil(a1 * nOrig) - 1);
    for (let j = j0; j <= j1; j++) {
      const b0 = j / nOrig;
      const b1 = (j + 1) / nOrig;
      const w = Math.min(a1, b1) - Math.max(a0, b0);
      if (w > 1e-12) saida.push([j, w * nDest]);
    }
    return saida;
  };

  const resultado: number[] = [];
  for (let r = 0; r < destinoLinhas; r++) {
    const ys = sobreposicao(r, destinoLinhas, origemLinhas);
    for (let c = 0; c < destinoColunas; c++) {
      const xs = sobreposicao(c, destinoColunas, origemColunas);
      let coberto = 0;
      for (const [jy, wy] of ys)
        for (const [jx, wx] of xs) if (set.has(jy * origemColunas + jx)) coberto += wy * wx;
      if (coberto >= 0.5 - 1e-9) resultado.push(r * destinoColunas + c);
    }
  }
  return resultado;
}

/** Converte a máscara salva de um registro (qualquer grade) para 32x24. */
export function mascaraPadrao(registro: {
  colunas?: unknown;
  linhas?: unknown;
  ignorados?: unknown;
} | null | undefined): number[] {
  if (!registro || !Array.isArray(registro.ignorados)) return [];
  const ok = (v: unknown, p: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 256 ? v : p;
  const col = ok(registro.colunas, GRADE_LEGADA_COLUNAS);
  const lin = ok(registro.linhas, GRADE_LEGADA_LINHAS);
  const nums = (registro.ignorados as unknown[]).filter(
    (n): n is number => typeof n === "number",
  );
  return remapearIgnorados(nums, col, lin);
}
