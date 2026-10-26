/**
 * Portão de correr vazado: localiza a sequência de grades verticais e estima
 * quanto o portão abriu (0% = como a foto fechado, 100% = sem grades),
 * mais a temporização (confirmações + alerta após X s). Funções puras.
 */
export const LARG_GRADES = 192;
export const ALT_GRADES = 64;

/** Contraste de "vale escuro" por coluna (barras escuras sobre fundo mais claro ou o inverso). */
export function perfilColunas(v: Float32Array, larg = LARG_GRADES, alt = ALT_GRADES, desloc = 2): number[] {
  const media: number[] = new Array(larg).fill(NaN);
  for (let x = 0; x < larg; x++) {
    let s = 0, n = 0;
    for (let y = 0; y < alt; y++) {
      const p = v[y * larg + x];
      if (p !== undefined && Number.isFinite(p)) { s += p; n++; }
    }
    if (n >= alt * 0.25) media[x] = s / n;
  }
  const out: number[] = new Array(larg).fill(0);
  for (let x = desloc; x < larg - desloc; x++) {
    const a = media[x - desloc] ?? NaN, m = media[x] ?? NaN, b = media[x + desloc] ?? NaN;
    if (!Number.isFinite(a) || !Number.isFinite(m) || !Number.isFinite(b)) continue;
    out[x] = Math.abs((a + b) / 2 - m);
  }
  return out;
}

/** Picos locais com proeminência mínima, separados por ao menos `distancia` colunas. */
export function picos(p: number[], minimo = 6, distancia = 3): number[] {
  const cand: number[] = [];
  const v = (i: number) => p[i] ?? 0;
  for (let x = 2; x < p.length - 2; x++) {
    if (v(x) < minimo || !(v(x) > v(x - 1) && v(x) >= v(x + 1))) continue;
    const esq = Math.min(...p.slice(Math.max(0, x - 6), x));
    const dir = Math.min(...p.slice(x + 1, Math.min(p.length, x + 7)));
    if (v(x) - Math.max(esq, dir) >= minimo * 0.6) cand.push(x);
  }
  const esc: number[] = [];
  for (const x of [...cand].sort((a, b) => v(b) - v(a))) if (esc.every((z) => Math.abs(x - z) >= distancia)) esc.push(x);
  return esc.sort((a, b) => a - b);
}

/** Maior sequência de barras com espaçamento regular (descarta postes isolados do fundo). */
export function melhorSequencia(xs: number[], espacoMax = 14, espacoMin = 2, minimo = 4): number[] {
  if (!xs.length) return [];
  const grupos: number[][] = [[xs[0] ?? 0]];
  for (const x of xs.slice(1)) {
    const g = grupos[grupos.length - 1]!;
    const d = x - (g[g.length - 1] ?? 0);
    if (d >= espacoMin && d <= espacoMax) g.push(x);
    else grupos.push([x]);
  }
  return grupos.filter((g) => g.length >= minimo).sort((a, b) => b.length - a.length || b[b.length - 1]! - b[0]! - (a[a.length - 1]! - a[0]!))[0] ?? [];
}

export function barras(v: Float32Array, larg = LARG_GRADES, alt = ALT_GRADES): number[] {
  return melhorSequencia(picos(perfilColunas(v, larg, alt)));
}

export type AberturaGrades = {
  abertura: number;
  barrasFechado: number;
  barrasAtual: number;
  /** Leitura pelo ritmo das grades (periodicidade + bordas + SSIM), valores 0..1. */
  ritmo?: { estado: "aberto" | "fechado" | "incerto"; score: number; periodicidade: number; densidade: number; ssim: number; limiarFechar: number; limiarAbrir: number; pitch: number };
};

/**
 * Abertura estimada (%): parte da faixa de grades da foto "fechado" que não tem mais grades.
 * Funciona para portão correndo para qualquer lado. null = foto fechado sem grades suficientes.
 */
export function aberturaPorGrades(atual: Float32Array, fechado: Float32Array, larg = LARG_GRADES, alt = ALT_GRADES): AberturaGrades | null {
  const ref = barras(fechado, larg, alt);
  if (ref.length < 6) return null;
  const a = ref[0]!, b = ref[ref.length - 1]!;
  const ext = Math.max(1, b - a);
  const cur = barras(atual, larg, alt);
  if (!cur.length) return { abertura: 100, barrasFechado: ref.length, barrasAtual: 0 };
  const sobre = Math.max(0, Math.min(b, cur[cur.length - 1]!) - Math.max(a, cur[0]!));
  const abertura = Math.round(Math.min(100, Math.max(0, 100 * (1 - sobre / ext))) * 10) / 10;
  return { abertura, barrasFechado: ref.length, barrasAtual: cur.length };
}

/** Melhor (menor) abertura entre as fotos de fechado; null se nenhuma tiver grades suficientes. */
export function aberturaContraFotos(atual: Float32Array, fechados: Float32Array[]): AberturaGrades | null {
  let melhor: AberturaGrades | null = null;
  for (const f of fechados) {
    const r = aberturaPorGrades(atual, f);
    if (r && (!melhor || r.abertura < melhor.abertura)) melhor = r;
  }
  return melhor;
}

/** Faixas: até 5% = fechado; a partir de 12% = aberto; entre = incerto (portão em movimento curto). */
export function estadoPorAbertura(abertura: number): "aberto" | "fechado" | "incerto" {
  if (abertura <= 5) return "fechado";
  if (abertura >= 12) return "aberto";
  return "incerto";
}

/* ---------- temporização (como config_portao.json → temporizacao) ---------- */
export type Temporizacao = { confirmacoes: number; alertarAposSegundos: number };
export type EstadoTempo = {
  status: "aberto" | "fechado" | "incerto";
  candidato: "aberto" | "fechado" | null;
  seguidas: number;
  abertoDesdeMs: number | null;
  alertaEmitido: boolean;
};
export const TEMPO_INICIAL: EstadoTempo = { status: "incerto", candidato: null, seguidas: 0, abertoDesdeMs: null, alertaEmitido: false };

/** Avança uma leitura: troca o status só após N leituras iguais; alerta uma vez após X s aberto. */
export function avancarTempo(
  s: EstadoTempo,
  leitura: "aberto" | "fechado" | "incerto",
  agoraMs: number,
  cfg: Temporizacao,
): EstadoTempo & { tempoAbertoSegundos: number; alertaAtivo: boolean; novoAlerta: boolean } {
  let n = { ...s };
  if (leitura === "incerto") n.seguidas = 0, n.candidato = null;
  else if (leitura === n.status) n.candidato = null, n.seguidas = 0;
  else {
    n.seguidas = n.candidato === leitura ? n.seguidas + 1 : 1;
    n.candidato = leitura;
    if (n.seguidas >= Math.max(1, cfg.confirmacoes)) {
      n = { status: leitura, candidato: null, seguidas: 0, abertoDesdeMs: leitura === "aberto" ? agoraMs : null, alertaEmitido: false };
    }
  }
  const tempo = n.status === "aberto" && n.abertoDesdeMs !== null ? Math.floor((agoraMs - n.abertoDesdeMs) / 1000) : 0;
  const alertaAtivo = n.status === "aberto" && tempo >= cfg.alertarAposSegundos;
  const novoAlerta = alertaAtivo && !n.alertaEmitido;
  if (alertaAtivo) n.alertaEmitido = true;
  return { ...n, tempoAbertoSegundos: tempo, alertaAtivo, novoAlerta };
}
