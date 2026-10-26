export type Celula = { c: number; r: number; cs: number; rs: number };
export type Mosaico = {
  id: string;
  nome: string;
  colunas: number;
  linhas: number;
  celulas: Celula[];
};

function grade(id: string, nome: string, colunas: number, linhas: number): Mosaico {
  const celulas: Celula[] = [];
  for (let r = 1; r <= linhas; r++) {
    for (let c = 1; c <= colunas; c++) celulas.push({ c, r, cs: 1, rs: 1 });
  }
  return { id, nome, colunas, linhas, celulas };
}

export const MOSAICOS: Mosaico[] = [
  grade("1x1", "1 câmera", 1, 1),
  grade("2x1", "2×1", 2, 1),
  grade("2x2", "2×2", 2, 2),
  grade("3x2", "3×2", 3, 2),
  grade("3x3", "3×3", 3, 3),
  grade("4x3", "4×3", 4, 3),
  grade("4x4", "4×4", 4, 4),
  {
    id: "destaque-lateral",
    nome: "1 grande + 4 laterais",
    colunas: 4,
    linhas: 4,
    celulas: [
      { c: 1, r: 1, cs: 3, rs: 4 },
      { c: 4, r: 1, cs: 1, rs: 1 },
      { c: 4, r: 2, cs: 1, rs: 1 },
      { c: 4, r: 3, cs: 1, rs: 1 },
      { c: 4, r: 4, cs: 1, rs: 1 },
    ],
  },
  {
    id: "destaque-inferior",
    nome: "1 grande + 4 embaixo",
    colunas: 4,
    linhas: 4,
    celulas: [
      { c: 1, r: 1, cs: 4, rs: 3 },
      { c: 1, r: 4, cs: 1, rs: 1 },
      { c: 2, r: 4, cs: 1, rs: 1 },
      { c: 3, r: 4, cs: 1, rs: 1 },
      { c: 4, r: 4, cs: 1, rs: 1 },
    ],
  },
  {
    id: "duas-grandes",
    nome: "2 grandes + 4 miniaturas",
    colunas: 4,
    linhas: 4,
    celulas: [
      { c: 1, r: 1, cs: 2, rs: 2 },
      { c: 3, r: 1, cs: 2, rs: 2 },
      { c: 1, r: 3, cs: 1, rs: 2 },
      { c: 2, r: 3, cs: 1, rs: 2 },
      { c: 3, r: 3, cs: 1, rs: 2 },
      { c: 4, r: 3, cs: 1, rs: 2 },
    ],
  },
  {
    id: "principal-grade",
    nome: "1 principal + grade",
    colunas: 3,
    linhas: 3,
    celulas: [
      { c: 1, r: 1, cs: 2, rs: 2 },
      { c: 3, r: 1, cs: 1, rs: 1 },
      { c: 3, r: 2, cs: 1, rs: 1 },
      { c: 1, r: 3, cs: 1, rs: 1 },
      { c: 2, r: 3, cs: 1, rs: 1 },
      { c: 3, r: 3, cs: 1, rs: 1 },
    ],
  },
  {
    id: "duas-grandes-laterais",
    nome: "2 grandes + miniaturas laterais",
    colunas: 4,
    linhas: 4,
    celulas: [
      { c: 1, r: 1, cs: 1, rs: 1 },
      { c: 1, r: 2, cs: 1, rs: 1 },
      { c: 1, r: 3, cs: 1, rs: 1 },
      { c: 1, r: 4, cs: 1, rs: 1 },
      { c: 2, r: 1, cs: 3, rs: 2 },
      { c: 2, r: 3, cs: 3, rs: 2 },
    ],
  },
];

/**
 * Monta um mosaico automático para `n` câmeras. A grade é quase quadrada
 * (cols ≈ √n) e jamais coloca mais de 2 câmeras lado a lado sem uma linha
 * embaixo: linha única é limitada a 2 colunas e a última linha parcial
 * também fica com no máx 2 câmeras. Quando a última linha não é cheia, as
 * câmeras restantes são distribuídas de forma uniforme para preencher a largura.
 */
export function mosaicoAutomatico(n: number): Mosaico {
  const total = Math.max(1, Math.floor(n));
  // Escolhe o número de colunas que deixa a grade mais quadrada, respeitando:
  // - linha única (rows = 1) jamais passa de 2 colunas;
  // - a última linha parcial nunca tem mais de 2 câmeras (resto ∈ {0,1,2}).
  let melhorCols = total <= 2 ? total : 2;
  let melhorDiff = Infinity;
  for (let cols = 1; cols <= total; cols++) {
    const rows = Math.ceil(total / cols);
    if (rows === 1 && cols > 2) continue; // linha única no máx 2
    const resto = total % cols; // 0 = linha cheia (qualquer largura)
    if (resto > 2) continue; // linha parcial > 2 rejeitada
    const diff = Math.abs(cols - rows);
    if (diff < melhorDiff || (diff === melhorDiff && cols > melhorCols)) {
      melhorDiff = diff;
      melhorCols = cols;
    }
  }
  const cols = melhorCols;
  const rows = Math.ceil(total / cols);
  const celulas: Celula[] = [];
  for (let r = 1; r <= rows; r++) {
    const naLinha = r < rows ? cols : total - cols * (rows - 1);
    // distribui `naLinha` câmeras em `cols` colunas de forma uniforme
    const base = Math.floor(cols / naLinha);
    const extra = cols % naLinha;
    let c = 1;
    for (let i = 0; i < naLinha; i++) {
      const span = base + (i < extra ? 1 : 0);
      celulas.push({ c, r, cs: span, rs: 1 });
      c += span;
    }
  }
  return {
    id: `auto-${total}`,
    nome: `Automático · ${total} câmera${total > 1 ? "s" : ""}`,
    colunas: cols,
    linhas: rows,
    celulas,
  };
}

/** Quando o template é "auto-N", devolve N (capacidade máxima). Senão, null. */
export function limiteAuto(template: string | null | undefined): number | null {
  if (!template?.startsWith("auto-")) return null;
  const n = Number(template.slice(5));
  return n > 0 ? Math.min(64, Math.floor(n)) : null;
}

/**
 * Mosaico do layout considerando quantas câmeras ele realmente tem.
 * Em layouts automáticos a grade acompanha a quantidade usada (+ `extra`
 * posições livres), sem passar da capacidade máxima escolhida.
 */
export function mosaicoAdaptado(
  template: string | null | undefined,
  colunas: number,
  linhas: number,
  usadas: number,
  extra = 0,
): Mosaico {
  const limite = limiteAuto(template);
  if (limite) {
    const n = Math.min(limite, Math.max(1, usadas + extra));
    return mosaicoAutomatico(n);
  }
  return mosaicoDe(template, colunas, linhas);
}

/* ---------- Formatos personalizados ----------
   Guardados no campo `template` do layout como
   `custom:COLxLIN:c.r.cs.rs_c.r.cs.rs...`, para que a leitura
   continue síncrona em todas as telas.                        */

export function codificarCustom(colunas: number, linhas: number, celulas: Celula[]) {
  const corpo = celulas.map((c) => `${c.c}.${c.r}.${c.cs}.${c.rs}`).join("_");
  return `custom:${colunas}x${linhas}:${corpo}`;
}

export function decodificarCustom(template: string | null | undefined): Mosaico | null {
  if (!template?.startsWith("custom:")) return null;
  const [, dim, corpo] = template.split(":");
  const [colunas, linhas] = (dim ?? "").split("x").map(Number);
  if (!colunas || !linhas || !corpo) return null;
  const celulas: Celula[] = [];
  for (const parte of corpo.split("_")) {
    const [c, r, cs, rs] = parte.split(".").map(Number);
    if (!c || !r || !cs || !rs) continue;
    celulas.push({ c, r, cs, rs });
  }
  if (!celulas.length) return null;
  return { id: template, nome: "Personalizado", colunas, linhas, celulas };
}

export function mosaicoDe(
  template: string | null | undefined,
  colunas: number,
  linhas: number,
): Mosaico {
  const custom = decodificarCustom(template);
  if (custom) return custom;
  if (template?.startsWith("auto-")) {
    const n = Number(template.slice(5));
    if (n > 0) return mosaicoAutomatico(n);
  }
  const achado = template ? MOSAICOS.find((m) => m.id === template) : undefined;
  if (achado) return achado;
  const id = `${colunas}x${linhas}`;
  return MOSAICOS.find((m) => m.id === id) ?? grade(id, id, colunas, linhas);
}


export function estiloCelula(cel: Celula) {
  return {
    gridColumn: `${cel.c} / span ${cel.cs}`,
    gridRow: `${cel.r} / span ${cel.rs}`,
  } as const;
}
