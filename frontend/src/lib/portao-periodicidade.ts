/**
 * Portão vazado pelo "ritmo" das grades: o passo (pitch) das barras é aprendido
 * da foto Fechado e a leitura mede quanta energia existe nessa frequência.
 * Carro, poste e casa não têm esse ritmo; chuva é ruído espalhado.
 * Fusão: periodicidade 60% + densidade de bordas verticais 25% + SSIM 15%.
 * Funções puras (vetores cinza larg×alt, NaN fora do contorno).
 */
import { ssim } from "./portao-processamento";

export const PESOS = { periodicidade: 0.6, bordas: 0.25, ssim: 0.15 } as const;

/** Média por coluna; colunas sem pixels válidos recebem a média geral. */
export function perfilMedio(v: Float32Array, larg: number, alt: number): number[] {
  const out: number[] = new Array(larg).fill(NaN);
  for (let x = 0; x < larg; x++) {
    let s = 0, n = 0;
    for (let y = 0; y < alt; y++) { const p = v[y * larg + x]; if (p !== undefined && Number.isFinite(p)) { s += p; n++; } }
    if (n >= alt * 0.2) out[x] = s / n;
  }
  const val = out.filter(Number.isFinite);
  const m = val.length ? val.reduce((a, b) => a + b, 0) / val.length : 0;
  const cheio = out.map((p) => (Number.isFinite(p) ? p : m));
  // Passa-alta: tira a média móvel (luz/sombra larga, céu, carro inteiro) e deixa o ritmo fino das barras.
  const r = Math.max(3, Math.round(larg / 24));
  return cheio.map((p, x) => {
    if (!Number.isFinite(out[x] ?? NaN)) return 0;
    let s = 0, n = 0;
    for (let i = Math.max(0, x - r); i <= Math.min(larg - 1, x + r); i++) { s += cheio[i] ?? m; n++; }
    return p - s / n;
  });
}

/** Magnitude² da DFT em frequência f (ciclos/coluna) num trecho do perfil. */
function potencia(p: number[], f: number, ini = 0, fim = p.length): number {
  let re = 0, im = 0;
  for (let i = ini; i < fim; i++) { const a = 2 * Math.PI * f * i; re += (p[i] ?? 0) * Math.cos(a); im -= (p[i] ?? 0) * Math.sin(a); }
  return re * re + im * im;
}

/** Passo dominante (colunas por barra): portão vazado tem pelo menos 12 barras na largura. */
export function pitchDominante(p: number[]): number {
  const n = p.length;
  let melhor = 0, pitch = 8;
  for (let k = Math.max(4, Math.ceil(n / 16)); k <= Math.floor(n / 3); k++) {
    const e = potencia(p, k / n);
    if (e > melhor) { melhor = e; pitch = n / k; }
  }
  return pitch;
}

/** Fração da energia (sem DC) na banda do pitch ±25% (+ metade do 2º harmônico). */
export function energiaNoPitch(p: number[], pitch: number, ini = 0, fim = p.length): number {
  const n = fim - ini;
  if (n < 6) return 0;
  let total = 0, banda = 0;
  const fc = 1 / pitch;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    const f = k / n;
    const e = potencia(p, f, ini, fim);
    total += e;
    if (f >= fc / 1.35 && f <= fc * 1.35) banda += e;
    else if (f >= (2 * fc) / 1.35 && f <= 2 * fc * 1.35) banda += 0.5 * e;
  }
  return total > 0 ? banda / total : 0;
}

/** Fração das janelas ao longo da largura onde o ritmo do portão aparece. */
export function cobertura(p: number[], pitch: number, ref: number[]): number {
  const jan = Math.max(8, Math.round(pitch * 4));
  let ok = 0, tot = 0;
  for (let i = 0; i + jan <= p.length; i += Math.max(4, Math.round(jan / 2))) {
    const er = energiaNoPitch(ref, pitch, i, i + jan);
    if (er < 0.15) continue; // janela sem grades na própria foto fechado
    tot++;
    if (energiaNoPitch(p, pitch, i, i + jan) >= er * 0.5) ok++;
  }
  return tot ? ok / tot : 0;
}

/** Fração de pixels com borda vertical forte (|Sobel X| > limiar). */
export function densidadeBordas(v: Float32Array, larg: number, alt: number, limiar = 40): number {
  let fortes = 0, n = 0;
  for (let y = 1; y < alt - 1; y++) for (let x = 1; x < larg - 1; x++) {
    const p = (yy: number, xx: number) => v[yy * larg + xx] ?? NaN;
    const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
    if (!Number.isFinite(gx)) continue;
    n++;
    if (Math.abs(gx) / 4 > limiar) fortes++;
  }
  return n ? fortes / n : 0;
}

export type ReferenciaRitmo = { vetor: Float32Array; perfil: number[]; pitch: number; energia: number; densidade: number };

export function aprenderReferencia(v: Float32Array, larg: number, alt: number): ReferenciaRitmo | null {
  const perfil = perfilMedio(v, larg, alt);
  const pitch = pitchDominante(perfil);
  const energia = energiaNoPitch(perfil, pitch);
  const densidade = densidadeBordas(v, larg, alt);
  if (energia < 0.05 || densidade <= 0) return null; // foto fechado sem grades visíveis
  return { vetor: v, perfil, pitch, energia, densidade };
}

export type SinaisRitmo = { score: number; periodicidade: number; densidade: number; ssim: number; cobertura: number; pitch: number };

export type Pesos = { periodicidade: number; bordas: number; ssim: number };

/** Score 0..1 (1 = igual à foto fechado). Usa a referência que der o maior score. */
export function sinaisRitmo(v: Float32Array, refs: ReferenciaRitmo[], larg: number, alt: number, pesos: Pesos = PESOS): SinaisRitmo | null {
  if (!refs.length) return null;
  const perfil = perfilMedio(v, larg, alt);
  const dens = densidadeBordas(v, larg, alt);
  let melhor: SinaisRitmo | null = null;
  for (const r of refs) {
    const glob = Math.min(1, energiaNoPitch(perfil, r.pitch) / r.energia);
    const cob = cobertura(perfil, r.pitch, r.perfil);
    const periodicidade = 0.5 * glob + 0.5 * cob;
    const densidade = Math.min(1, dens / r.densidade);
    const s = ssim(v, r.vetor);
    const score = pesos.periodicidade * periodicidade + pesos.bordas * densidade + pesos.ssim * s;
    if (!melhor || score > melhor.score) melhor = { score, periodicidade, densidade, ssim: s, cobertura: cob, pitch: r.pitch };
  }
  return melhor;
}

export type Calibracao = { pesos: Pesos; scoresAberto: number[] };

/**
 * Ajusta os pesos pelas fotos Aberto: sinal que fica igual no aberto e no fechado
 * (não separa nesta câmera) perde peso; o que mais separa ganha. Sem fotos aberto = pesos fixos.
 */
export function calibrar(refs: ReferenciaRitmo[], abertos: Float32Array[], larg: number, alt: number): Calibracao {
  const brutos = abertos.map((a) => sinaisRitmo(a, refs, larg, alt)).filter((s): s is SinaisRitmo => !!s);
  if (!brutos.length) return { pesos: { ...PESOS }, scoresAberto: [] };
  const med = (k: "periodicidade" | "densidade" | "ssim") => brutos.reduce((s, b) => s + b[k], 0) / brutos.length;
  const p = PESOS.periodicidade * Math.max(0.03, 1 - med("periodicidade"));
  const b = PESOS.bordas * Math.max(0.03, 1 - med("densidade"));
  const s = PESOS.ssim * Math.max(0.03, 1 - med("ssim"));
  const t = p + b + s;
  const pesos = { periodicidade: p / t, bordas: b / t, ssim: s / t };
  const scoresAberto = abertos.map((a) => sinaisRitmo(a, refs, larg, alt, pesos)?.score).filter((x): x is number => x !== undefined);
  return { pesos, scoresAberto };
}

export type DecisaoRitmo = SinaisRitmo & { estado: "aberto" | "fechado" | "incerto"; abertura: number; limiarFechar: number; limiarAbrir: number; scoreAberto: number };

/**
 * Limiares calibrados pelas fotos: o score das fotos Aberto vira o "0%"
 * (sem fotos, assume 0,3). Fechado acima de 60% do caminho, aberto abaixo de 35%;
 * entre os dois = incerto (histerese). Sensibilidade maior estreita a faixa incerta.
 */
export function decidirRitmo(atual: SinaisRitmo, scoresAberto: number[], sensibilidade: number): DecisaoRitmo {
  const sA = scoresAberto.length ? Math.min(0.85, scoresAberto.reduce((a, b) => a + b, 0) / scoresAberto.length) : 0.3;
  const sens = Math.min(100, Math.max(0, sensibilidade)) / 100;
  const vao = 1 - sA;
  const limiarFechar = sA + vao * (0.65 - sens * 0.1);
  const limiarAbrir = sA + vao * (0.3 + sens * 0.1);
  const estado = atual.score >= limiarFechar ? "fechado" : atual.score <= limiarAbrir ? "aberto" : "incerto";
  const abertura = Math.round(Math.max(0, Math.min(1, (1 - atual.score) / Math.max(0.05, vao))) * 1000) / 10;
  return { ...atual, estado, abertura, limiarFechar, limiarAbrir, scoreAberto: sA };
}
