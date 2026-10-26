/**
 * Portão 2.0 — ritmo ancorado. O passo das barras é aprendido UMA vez das fotos
 * Fechado (mediana) e a leitura só procura energia nesse passo (±15%), nunca
 * reprocura o pitch no quadro atual (evita "achar ritmo" em poste/carro/chuva).
 *
 * Análise espectral própria do 2.0 (não altera portao-periodicidade.ts, usado pelo 1.0):
 * - janela de Hanning e fase relativa ao início do trecho (reduz vazamento espectral);
 * - cobertura + continuidade (picos só nas extremidades não contam como portão inteiro);
 * - consistência do espaçamento (autocorrelação no passo da referência);
 * - qualidade da imagem (contraste/área válida) relativa à própria foto Fechado.
 * Funções puras; vetores cinza larg×alt com NaN fora do contorno.
 */
import { densidadeBordas, perfilMedio, pitchDominante } from "../portao-periodicidade";
import { ssim } from "../portao-processamento";

type Ref = { vetor: Float32Array; perfil: number[]; energia: number; densidade: number; contraste: number; validos: number; autocorr: number };
export type AncoraV2 = { pitch: number; refs: Ref[] };

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const lim = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** Magnitude² da DFT com janela de Hanning; fase relativa ao início do trecho. */
export function potenciaHann(p: number[], f: number, ini = 0, fim = p.length, hann = true): number {
  const n = fim - ini;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const w = hann && n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    const v = (p[ini + i] ?? 0) * w;
    const a = 2 * Math.PI * f * i;
    re += v * Math.cos(a);
    im -= v * Math.sin(a);
  }
  return re * re + im * im;
}

/** Fração da energia (sem DC) na banda do passo ±25% (+ metade do 2º harmônico). */
export function energiaV2(p: number[], pitch: number, ini = 0, fim = p.length, hann = true): number {
  const n = fim - ini;
  if (n < 6 || !(pitch > 0)) return 0;
  // Média removida do trecho para a janela não reintroduzir DC.
  let m = 0;
  for (let i = ini; i < fim; i++) m += p[i] ?? 0;
  m /= n;
  const q = p.slice(ini, fim).map((x) => (x ?? 0) - m);
  let total = 0, banda = 0;
  const fc = 1 / pitch;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    const f = k / n;
    const e = potenciaHann(q, f, 0, n, hann);
    total += e;
    if (f >= fc / 1.35 && f <= fc * 1.35) banda += e;
    else if (f >= (2 * fc) / 1.35 && f <= 2 * fc * 1.35) banda += 0.5 * e;
  }
  return total > 0 ? banda / total : 0;
}

/** Autocorrelação normalizada no passo (fracionário, interpolado). 1 = espaçamento idêntico ao passo. */
export function autocorrNoPasso(p: number[], pitch: number): number {
  const n = p.length;
  const m = p.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const q = p.map((x) => x - m);
  const v0 = q.reduce((a, b) => a + b * b, 0);
  if (v0 <= 1e-9) return 0;
  const lo = Math.floor(pitch), fr = pitch - lo;
  let s = 0;
  for (let i = 0; i + lo + 1 < n; i++) s += q[i]! * ((1 - fr) * q[i + lo]! + fr * q[i + lo + 1]!);
  return s / v0;
}

function contrasteEValidos(v: Float32Array): { contraste: number; validos: number } {
  let s = 0, s2 = 0, n = 0;
  for (const x of v) if (Number.isFinite(x)) { s += x; s2 += x * x; n++; }
  if (!n) return { contraste: 0, validos: 0 };
  const m = s / n;
  return { contraste: Math.sqrt(Math.max(0, s2 / n - m * m)), validos: n / v.length };
}

/** Janelas da largura onde a referência tem grades; para cada uma, se o quadro atual também tem. */
function janelas(p: number[], pitch: number, ref: number[]) {
  const jan = Math.max(8, Math.round(pitch * 4));
  const passo = Math.max(4, Math.round(jan / 2));
  const out: boolean[] = [];
  for (let i = 0; i + jan <= p.length; i += passo) {
    const er = energiaV2(ref, pitch, i, i + jan);
    if (er < 0.15) continue; // trecho sem grades na própria foto Fechado
    out.push(energiaV2(p, pitch, i, i + jan) >= er * 0.5);
  }
  return out;
}

/** Cobertura (fração das janelas com grade) e continuidade (maior sequência contínua / total). */
export function coberturaV2(p: number[], pitch: number, ref: number[]): { cobertura: number; continuidade: number } {
  const js = janelas(p, pitch, ref);
  if (!js.length) return { cobertura: 0, continuidade: 0 };
  let run = 0, melhor = 0;
  for (const ok of js) { run = ok ? run + 1 : 0; melhor = Math.max(melhor, run); }
  return { cobertura: js.filter(Boolean).length / js.length, continuidade: melhor / js.length };
}

/** Aprende o passo das fotos Fechado. Fotos sem grades ou com passo destoante (>20% da mediana) são descartadas. */
export function ancorar(fechados: Float32Array[], larg: number, alt: number): AncoraV2 | null {
  const cand = fechados.map((v) => {
    const perfil = perfilMedio(v, larg, alt);
    return { vetor: v, perfil, pitch: pitchDominante(perfil), densidade: densidadeBordas(v, larg, alt), ...contrasteEValidos(v) };
  });
  if (!cand.length) return null;
  const pitch = mediana(cand.map((c) => c.pitch));
  const refs = cand
    .filter((c) => Math.abs(c.pitch - pitch) / pitch <= 0.2)
    .map((c) => ({ ...c, energia: energiaV2(c.perfil, pitch), autocorr: autocorrNoPasso(c.perfil, pitch) }))
    .filter((c) => c.energia >= 0.05 && c.densidade > 0);
  return refs.length ? { pitch, refs } : null;
}

export type SinaisV2 = {
  periodicidade: number;
  densidade: number;
  ssim: number;
  pitch: number;
  /** Detalhes (0..1) do ritmo. Opcionais para manter o contrato anterior. */
  energia?: number;
  cobertura?: number;
  continuidade?: number;
  espacamento?: number;
  /** Qualidade da imagem relativa à foto Fechado (contraste e área válida). Baixa = motivo de Incerto. */
  qualidade?: number;
};

/** Pesos internos da periodicidade: nenhum sinal sozinho decide o ritmo. */
export const PESOS_RITMO = { energia: 0.2, cobertura: 0.3, continuidade: 0.25, espacamento: 0.25 } as const;

/** Sinais 0..1 relativos à melhor foto Fechado. */
export function medir(v: Float32Array, a: AncoraV2, larg: number, alt: number): SinaisV2 {
  const perfil = perfilMedio(v, larg, alt);
  const dens = densidadeBordas(v, larg, alt);
  const { contraste, validos } = contrasteEValidos(v);
  let melhor: SinaisV2 = { periodicidade: 0, densidade: 0, ssim: 0, pitch: a.pitch, qualidade: 0 };
  let melhorSoma = -1;
  for (const r of a.refs) {
    let e = 0;
    for (const f of [0.85, 0.925, 1, 1.075, 1.15]) e = Math.max(e, energiaV2(perfil, a.pitch * f));
    const energia = lim(e / r.energia);
    const { cobertura, continuidade } = coberturaV2(perfil, a.pitch, r.perfil);
    const espacamento = r.autocorr > 0 ? lim(autocorrNoPasso(perfil, a.pitch) / r.autocorr) : 0;
    const periodicidade =
      PESOS_RITMO.energia * energia + PESOS_RITMO.cobertura * cobertura + PESOS_RITMO.continuidade * continuidade + PESOS_RITMO.espacamento * espacamento;
    // Qualidade: contraste em relação à foto Fechado (1/3 já basta para ver barras) e área válida.
    const qualidade = Math.min(lim(r.contraste > 0 ? contraste / (r.contraste / 3) : 0), lim(r.validos > 0 ? validos / (r.validos * 0.8) : 0));
    const s: SinaisV2 = {
      periodicidade, densidade: lim(dens / r.densidade), ssim: lim(ssim(v, r.vetor)), pitch: a.pitch,
      energia, cobertura, continuidade, espacamento, qualidade,
    };
    const soma = s.periodicidade + s.densidade + s.ssim;
    if (soma > melhorSoma) { melhorSoma = soma; melhor = s; }
  }
  return melhor;
}

// ───────────────────────── Etapa G4: passo validado ─────────────────────────
// `ancorar` acima continua idêntico (é a base da paridade com o C# isolado em agent/PortaoV2).
// A tela do 2.0 usa `ancorarValidado`, que só aceita um passo confirmado pela autocorrelação.

/**
 * Autocorrelação mínima no passo para aceitar um pico espectral como espaçamento real das barras.
 * Valor PROVISÓRIO: separa barras sintéticas (autocorrelação ≥ 0,6) de rampas/ruído (≤ 0,1), mas NÃO foi
 * confirmado nas fotos reais (lá, em 192 colunas, a autocorrelação ficou entre −0,03 e 0,28). Por isso
 * `ancorarValidado` ainda não está ligado à tela — ver relatório da Etapa G4.
 */
export const AUTOCORR_MIN_PASSO = 0.2;

/** autocorr = autocorrelação no passo menos a do meio-passo (contraste de periodicidade). */
export type PassoV2 = { pitch: number; autocorr: number; valido: boolean };

/** Passo dominante com janela de Hanning; percorre os picos do mais forte ao mais fraco e aceita
 *  o primeiro cuja autocorrelação no passo seja ≥ AUTOCORR_MIN_PASSO. Mesma faixa de busca do 1.0. */
export function pitchDominanteV2(p: number[]): PassoV2 {
  const n = p.length;
  if (n < 12) return { pitch: 8, autocorr: 0, valido: false };
  const m = p.reduce((a, b) => a + b, 0) / n;
  const q = p.map((x) => x - m);
  const ks: { k: number; e: number }[] = [];
  const kMin = Math.max(4, Math.ceil(n / 16)), kMax = Math.floor(n / 3);
  const pot = (k: number) => potenciaHann(q, k / n);
  for (let k = kMin; k <= kMax; k++) {
    const e = pot(k);
    // Só máximos locais contam como candidatos (evita testar o "ombro" do mesmo pico).
    if (e >= pot(k - 1) && e >= pot(k + 1)) ks.push({ k, e });
  }
  ks.sort((a, b) => b.e - a.e);
  let primeiro: PassoV2 | null = null;
  for (const { k } of ks) {
    const pitch = n / k;
    // Barras reais: correlação alta no passo e baixa/negativa no meio-passo. Sinal liso (rampa)
    // correlaciona alto em qualquer atraso curto; por isso medimos o CONTRASTE passo − meio-passo.
    const autocorr = autocorrNoPasso(q, pitch) - autocorrNoPasso(q, pitch / 2);
    primeiro ??= { pitch, autocorr, valido: false };
    if (autocorr >= AUTOCORR_MIN_PASSO) return { pitch, autocorr, valido: true };
  }
  return primeiro ?? { pitch: 8, autocorr: 0, valido: false };
}

export type MotivoRejeicaoV2 = "sem_passo_periodico" | "passo_destoante" | "sem_energia_no_passo" | "sem_bordas" | "autocorr_insuficiente";
export type DiagnosticoRefV2 = { indice: number; pitch: number; autocorr: number; aceita: boolean; motivo?: MotivoRejeicaoV2 };
export type AncoragemV2 = { ancora: AncoraV2 | null; diagnostico: DiagnosticoRefV2[] };

/** Ancoragem com validação estrutural. Nunca apaga fotos: só informa quais entram e por quê. */
export function ancorarValidado(fechados: Float32Array[], larg: number, alt: number): AncoragemV2 {
  const cand = fechados.map((v, indice) => {
    const perfil = perfilMedio(v, larg, alt);
    return { indice, vetor: v, perfil, passo: pitchDominanteV2(perfil), densidade: densidadeBordas(v, larg, alt), ...contrasteEValidos(v) };
  });
  const diag: DiagnosticoRefV2[] = cand.map((c) => ({ indice: c.indice, pitch: c.passo.pitch, autocorr: c.passo.autocorr, aceita: false }));
  const validos = cand.filter((c) => c.passo.valido);
  for (const c of cand) if (!c.passo.valido) diag[c.indice]!.motivo = "sem_passo_periodico";
  if (!validos.length) return { ancora: null, diagnostico: diag };
  const pitch = mediana(validos.map((c) => c.passo.pitch));
  const refs: Ref[] = [];
  for (const c of validos) {
    const d = diag[c.indice]!;
    if (Math.abs(c.passo.pitch - pitch) / pitch > 0.2) { d.motivo = "passo_destoante"; continue; }
    const energia = energiaV2(c.perfil, pitch);
    const autocorr = autocorrNoPasso(c.perfil, pitch);
    const contraste = autocorr - autocorrNoPasso(c.perfil, pitch / 2);
    d.autocorr = contraste;
    if (contraste < AUTOCORR_MIN_PASSO) { d.motivo = "autocorr_insuficiente"; continue; }
    if (energia < 0.05) { d.motivo = "sem_energia_no_passo"; continue; }
    if (!(c.densidade > 0)) { d.motivo = "sem_bordas"; continue; }
    d.aceita = true;
    refs.push({ vetor: c.vetor, perfil: c.perfil, energia, densidade: c.densidade, contraste: c.contraste, validos: c.validos, autocorr });
  }
  return { ancora: refs.length ? { pitch, refs } : null, diagnostico: diag };
}
