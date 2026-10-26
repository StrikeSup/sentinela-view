/**
 * Etapas opcionais da leitura do portão (modo de calibração Avançada).
 * Funções puras: o navegador e o Agent aplicam as mesmas etapas ligadas.
 * Com o modo Padrão (ou os valores padrão), a leitura é a original.
 */
export type OpcoesPortao = {
  /** Considera só o interior do contorno (desligado = caixa retangular inteira). */
  mascara: boolean;
  /** Realce de contraste adaptativo por blocos (CLAHE) no lugar da equalização comum. */
  clahe: boolean;
  /** Estimativa de abertura pelas grades verticais. */
  grades: boolean;
  /** Similaridade estrutural (SSIM) com as fotos, no lugar da diferença de pixels. */
  ssim: boolean;
  /** Só troca de estado quando houve movimento dentro da área (com checagem a cada 30 s). */
  movimento: boolean;
};

/** Valores que reproduzem a leitura original. */
export const OPCOES_PADRAO: OpcoesPortao = { mascara: true, clahe: false, grades: true, ssim: false, movimento: false };

/** Opções efetivas: no modo Padrão sempre as originais; no Avançado, as salvas. */
export function opcoesEfetivas(avancado: boolean, salvas?: Partial<OpcoesPortao> | null): OpcoesPortao {
  if (!avancado) return { ...OPCOES_PADRAO };
  const o = { ...OPCOES_PADRAO };
  for (const k of Object.keys(o) as (keyof OpcoesPortao)[]) if (typeof salvas?.[k] === "boolean") o[k] = salvas[k] as boolean;
  return o;
}

/** Cinza 0..255 a partir de RGBA. */
export function cinza(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.round(0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0));
  return g;
}

/**
 * CLAHE: equaliza cada bloco com histograma limitado e interpola entre blocos.
 * Pixels fora da máscara viram NaN e não entram nos histogramas.
 */
export function clahe(g: Uint8Array, larg: number, alt: number, mascara?: Uint8Array, blocos = 4, limite = 3): Float32Array {
  const bx = Math.max(1, Math.min(blocos, larg)), by = Math.max(1, Math.min(blocos, alt));
  const tw = larg / bx, th = alt / by;
  const mapas: Float32Array[] = [];
  for (let j = 0; j < by; j++) {
    for (let i = 0; i < bx; i++) {
      const hist = new Array(256).fill(0);
      let n = 0;
      for (let y = Math.floor(j * th); y < Math.floor((j + 1) * th); y++) {
        for (let x = Math.floor(i * tw); x < Math.floor((i + 1) * tw); x++) {
          const p = y * larg + x;
          if (mascara && !mascara[p]) continue;
          hist[g[p] ?? 0]++;
          n++;
        }
      }
      const mapa = new Float32Array(256);
      if (n) {
        const teto = Math.max(1, (limite * n) / 256);
        let excesso = 0;
        for (let v = 0; v < 256; v++) if (hist[v] > teto) { excesso += hist[v] - teto; hist[v] = teto; }
        const extra = excesso / 256;
        let acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v] + extra; mapa[v] = (acc / n) * 255; }
      } else for (let v = 0; v < 256; v++) mapa[v] = v;
      mapas.push(mapa);
    }
  }
  const out = new Float32Array(larg * alt);
  for (let y = 0; y < alt; y++) {
    const fy = Math.min(by - 1, Math.max(0, (y + 0.5) / th - 0.5));
    const j0 = Math.floor(fy), j1 = Math.min(by - 1, j0 + 1), wy = fy - j0;
    for (let x = 0; x < larg; x++) {
      const p = y * larg + x;
      if (mascara && !mascara[p]) { out[p] = NaN; continue; }
      const fx = Math.min(bx - 1, Math.max(0, (x + 0.5) / tw - 0.5));
      const i0 = Math.floor(fx), i1 = Math.min(bx - 1, i0 + 1), wx = fx - i0;
      const v = g[p] ?? 0;
      const m = (jj: number, ii: number) => mapas[jj * bx + ii]![v]!;
      out[p] = (1 - wy) * ((1 - wx) * m(j0, i0) + wx * m(j0, i1)) + wy * ((1 - wx) * m(j1, i0) + wx * m(j1, i1));
    }
  }
  return out;
}

/** SSIM global (0..1, 1 = mesma estrutura) entre dois vetores, ignorando NaN. */
export function ssim(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, k = 0;
  for (let i = 0; i < n; i++) { const x = a[i]!, y = b[i]!; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; sa += x; sb += y; k++; }
  if (k < 2) return 0;
  const ma = sa / k, mb = sb / k;
  let va = 0, vb = 0, cv = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    va += (x - ma) ** 2; vb += (y - mb) ** 2; cv += (x - ma) * (y - mb);
  }
  va /= k - 1; vb /= k - 1; cv /= k - 1;
  const c1 = (0.01 * 255) ** 2, c2 = (0.03 * 255) ** 2;
  const s = ((2 * ma * mb + c1) * (2 * cv + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
  return Math.max(0, Math.min(1, s));
}

export type DecisaoSsim = { estado: "aberto" | "fechado" | "incerto"; ssimFechado: number; ssimAberto: number };

/** Decide pela maior similaridade; margem mínima cai com a sensibilidade (0–100). */
export function decidirSsim(atual: Float32Array, fechado: Float32Array[], aberto: Float32Array[], sensibilidade: number): DecisaoSsim {
  const sF = fechado.length ? Math.max(...fechado.map((r) => ssim(atual, r))) : 0;
  const sA = aberto.length ? Math.max(...aberto.map((r) => ssim(atual, r))) : 0;
  const margem = 0.02 + (1 - Math.min(100, Math.max(0, sensibilidade)) / 100) * 0.08;
  const estado = Math.abs(sF - sA) < margem ? "incerto" : sF > sA ? "fechado" : "aberto";
  return { estado, ssimFechado: Math.round(sF * 100) / 100, ssimAberto: Math.round(sA * 100) / 100 };
}

/** Movimento na área: diferença média absoluta entre leituras seguidas (0..100). */
export function movimentoPct(atual: Float32Array, anterior: Float32Array | null): number {
  if (!anterior) return 100;
  const n = Math.min(atual.length, anterior.length);
  let s = 0, k = 0;
  for (let i = 0; i < n; i++) { const x = atual[i]!, y = anterior[i]!; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; s += Math.abs(x - y); k++; }
  return k ? Math.round((s / k / 255) * 1000) / 10 : 0;
}

/** Limiar de movimento (%) e intervalo da checagem sem movimento. */
export const MOVIMENTO_LIMIAR_PCT = 4;
export const CHECAGEM_SEM_MOVIMENTO_MS = 30_000;

/** Trava de movimento: sem movimento (e sem checagem vencida), mantém o estado já confirmado. */
export function travarPorMovimento(
  leitura: "aberto" | "fechado" | "incerto",
  confirmado: "aberto" | "fechado" | "incerto",
  movimento: number,
  msDesdeChecagem: number,
): { estado: "aberto" | "fechado" | "incerto"; travado: boolean } {
  if (confirmado === "incerto" || movimento >= MOVIMENTO_LIMIAR_PCT || msDesdeChecagem >= CHECAGEM_SEM_MOVIMENTO_MS) return { estado: leitura, travado: false };
  return { estado: confirmado, travado: leitura !== confirmado };
}
