/** Leitura do portão feita no navegador (prévia ao vivo da calibração). */
import { cinza, clahe } from "./portao-processamento";
export const LARG = 64;
export const ALT = 48;

/** Converte RGBA em cinza equalizado (histograma), 0..255. */
export function cinzaEqualizado(rgba: Uint8ClampedArray | number[], mascara?: Uint8Array): Float32Array {
  const n = Math.floor(rgba.length / 4);
  const g = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  let incluidos = 0;
  for (let i = 0; i < n; i++) {
    if (mascara && !mascara[i]) continue;
    const v = Math.round(0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0));
    g[i] = v;
    hist[v]++;
    incluidos++;
  }
  const cdf = new Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) cdf[i] = acc += hist[i];
  const min = cdf.find((c: number) => c > 0) ?? 0;
  const out = new Float32Array(n);
  const den = Math.max(1, incluidos - min);
  for (let i = 0; i < n; i++) out[i] = mascara && !mascara[i] ? NaN : ((cdf[g[i] ?? 0] - min) / den) * 255;
  return out;
}

/** Diferença média absoluta (0 = igual, 255 = oposto). */
export function diferenca(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 255;
  let s = 0;
  let incluidos = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i], bv = b[i];
    if (av === undefined || bv === undefined || !Number.isFinite(av) || !Number.isFinite(bv)) continue;
    s += Math.abs(av - bv);
    incluidos++;
  }
  return incluidos ? s / incluidos : 255;
}

/**
 * Força das grades verticais (0..1): média do gradiente horizontal (Sobel X),
 * que fica alto com barras verticais e ignora sombras suaves/céu uniforme.
 */
export function grades(v: Float32Array, larg = LARG, alt = ALT): number {
  if (v.length < larg * alt || larg < 3 || alt < 3) return 0;
  let s = 0;
  let n = 0;
  for (let y = 1; y < alt - 1; y++) {
    for (let x = 1; x < larg - 1; x++) {
      const p = (yy: number, xx: number) => v[yy * larg + xx] ?? NaN;
      if (![p(y, x), p(y - 1, x - 1), p(y, x - 1), p(y + 1, x - 1), p(y - 1, x + 1), p(y, x + 1), p(y + 1, x + 1)].every(Number.isFinite)) continue;
      const gx =
        p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
      s += Math.min(255, Math.abs(gx) / 4);
      n++;
    }
  }
  return n ? s / n / 255 : 0;
}

export type LeituraNavegador = {
  estado: "aberto" | "fechado" | "incerto";
  confianca: number;
  /** Diagnóstico: grades atuais em relação às fotos (0% = como aberto, 100% = como fechado). */
  gradesPct?: number;
  distFechado?: number;
  distAberto?: number;
  /** Abertura estimada pelas grades (0 = fechado, 100 = sem grades). */
  aberturaPct?: number;
};

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * Decide o estado. Primeiro pelas grades verticais (quando as fotos fechado/aberto
 * diferem nisso): se as grades sumiram, está aberto mesmo com carro/sombra diferente.
 * Senão, pela menor distância de pixels a cada grupo de referências.
 * Sensibilidade (0–100) maior aceita margens menores.
 */
export function classificar(
  atual: Float32Array,
  fechado: Float32Array[],
  aberto: Float32Array[],
  sensibilidade: number,
): LeituraNavegador {
  if (!fechado.length || !aberto.length) return { estado: "incerto", confianca: 0 };
  const sens = Math.min(100, Math.max(0, sensibilidade)) / 100;
  const dF = Math.min(...fechado.map((r) => diferenca(atual, r)));
  const dA = Math.min(...aberto.map((r) => diferenca(atual, r)));
  const distFechado = Math.round((dF / 255) * 100);
  const distAberto = Math.round((dA / 255) * 100);

  const gF = media(fechado.map((r) => grades(r)));
  const gA = media(aberto.map((r) => grades(r)));
  const g = grades(atual);
  const salto = gF - gA;
  if (gF > 0.01 && salto > gF * 0.2) {
    const pos = (g - gA) / salto; // 1 = como fechado, 0 = como aberto
    const gradesPct = Math.round(Math.max(0, Math.min(1, pos)) * 100);
    const limF = 0.75 - sens * 0.1; // acima disso: grades presentes
    const limA = 0.4 + sens * 0.1; // abaixo disso: grades sumiram
    if (pos >= limF) {
      return { estado: "fechado", confianca: Math.round(60 + Math.min(1, pos) * 40), gradesPct, distFechado, distAberto };
    }
    if (pos <= limA) {
      return { estado: "aberto", confianca: Math.round(60 + Math.min(1, 1 - pos) * 40), gradesPct, distFechado, distAberto };
    }
    // Zona intermediária (abrindo/fechando): desempata pelos pixels abaixo.
    const total = dF + dA;
    const margem = total === 0 ? 0 : Math.abs(dF - dA) / total;
    if (margem > 0.1) {
      return { estado: dF < dA ? "fechado" : "aberto", confianca: Math.round(50 + margem * 50), gradesPct, distFechado, distAberto };
    }
    // Grades já parcialmente sumidas → portão abrindo, trata como aberto.
    if (pos < 0.5) return { estado: "aberto", confianca: 55, gradesPct, distFechado, distAberto };
    return { estado: "incerto", confianca: 50, gradesPct, distFechado, distAberto };
  }

  const total = dF + dA;
  const margem = total === 0 ? 0 : Math.abs(dF - dA) / total; // 0..1
  const exigida = 0.02 + (1 - sens) * 0.18;
  const confianca = Math.round(50 + margem * 50);
  if (margem < exigida) return { estado: "incerto", confianca, distFechado, distAberto };
  return { estado: dF < dA ? "fechado" : "aberto", confianca, distFechado, distAberto };
}

/** Desenha uma fonte (vídeo/imagem) recortada em 64×48 e devolve o vetor cinza (CLAHE opcional). */
export function vetorDe(
  fonte: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  mascara?: Uint8Array,
  larg = LARG,
  alt = ALT,
  usarClahe = false,
): Float32Array | null {
  const c = document.createElement("canvas");
  c.width = larg;
  c.height = alt;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, larg, alt);
    const dados = ctx.getImageData(0, 0, larg, alt).data;
    return usarClahe ? clahe(cinza(dados), larg, alt, mascara) : cinzaEqualizado(dados, mascara);
  } catch {
    return null;
  }
}

export function carregarVetor(src: string, mascara?: Uint8Array, larg = LARG, alt = ALT, usarClahe = false): Promise<Float32Array | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(vetorDe(img, 0, 0, img.naturalWidth, img.naturalHeight, mascara, larg, alt, usarClahe));
    img.onerror = () => res(null);
    img.src = src;
  });
}
