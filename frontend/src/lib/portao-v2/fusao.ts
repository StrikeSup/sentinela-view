/**
 * Portão 2.0 — três camadas separadas:
 * 1) decidirV2: estimativa visual de UM quadro (nota técnica, não é probabilidade);
 * 2) confirmarV2: máquina de estados temporal (independe de movimento);
 * 3) alertaV2: tempo aberto e alerta, derivados só do estado confirmado.
 * Nota = 60% periodicidade + 25% bordas + 15% SSIM (pesos fixos: previsíveis).
 * Histerese: muda para Fechado acima de `fechar`, Aberto abaixo de `abrir`; no meio mantém `anterior`.
 */
import type { SinaisV2 } from "./ritmo";

export type EstadoV2 = "aberto" | "fechado" | "incerto";
export const PESOS_V2 = { periodicidade: 0.6, bordas: 0.25, ssim: 0.15 } as const;
/** Abaixo disso a imagem é considerada ruim demais para concluir (escuro, borrado, encoberto). */
export const QUALIDADE_MIN_V2 = 0.5;

export function limiaresV2(sensibilidade: number) {
  const s = Math.min(100, Math.max(0, sensibilidade)) / 100;
  return { fechar: 0.7 - s * 0.1, abrir: 0.4 + s * 0.1 };
}

export type DecisaoV2 = {
  estado: EstadoV2;
  nota: number;
  abertura: number;
  /** Nível técnico 0–100 (distância ao limiar). NÃO é probabilidade calibrada. */
  confianca: number;
  motivo: string;
  faixa?: "fechado" | "aberto" | "intermediaria" | "qualidade";
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function decidirV2(s: SinaisV2, sensibilidade: number, anterior: EstadoV2 = "incerto"): DecisaoV2 {
  const nota = PESOS_V2.periodicidade * s.periodicidade + PESOS_V2.bordas * s.densidade + PESOS_V2.ssim * s.ssim;
  const { fechar, abrir } = limiaresV2(sensibilidade);
  const abertura = Math.round(Math.max(0, Math.min(1, 1 - nota)) * 100);
  const extra = s.cobertura !== undefined ? `; cobertura ${pct(s.cobertura)}, continuidade ${pct(s.continuidade ?? 0)}, espaçamento ${pct(s.espacamento ?? 0)}` : "";
  const sinais = `ritmo ${pct(s.periodicidade)}, bordas ${pct(s.densidade)}, SSIM ${pct(s.ssim)}${extra}`;
  if (s.qualidade !== undefined && s.qualidade < QUALIDADE_MIN_V2) {
    return { estado: "incerto", nota, abertura, confianca: 0, faixa: "qualidade", motivo: `Imagem com qualidade baixa (${pct(s.qualidade)} < ${pct(QUALIDADE_MIN_V2)}): sem conclusão (${sinais})` };
  }
  if (nota >= fechar) {
    return { estado: "fechado", nota, abertura, faixa: "fechado", confianca: Math.round(60 + Math.min(1, (nota - fechar) / (1 - fechar)) * 40), motivo: `Fechado: nota ${pct(nota)} ≥ ${pct(fechar)} (${sinais})` };
  }
  if (nota <= abrir) {
    return { estado: "aberto", nota, abertura, faixa: "aberto", confianca: Math.round(60 + Math.min(1, (abrir - nota) / abrir) * 40), motivo: `Aberto: nota ${pct(nota)} ≤ ${pct(abrir)} (${sinais})` };
  }
  return { estado: anterior, nota, abertura, faixa: "intermediaria", confianca: 50, motivo: `Faixa intermediária ${pct(abrir)}–${pct(fechar)}: mantém ${anterior} (nota ${pct(nota)}; ${sinais})` };
}

/* ---------------- confirmação temporal ----------------
 * Regra (leitura a cada ~1 s):
 * - Uma troca precisa de `confirmacoes` (2) leituras VÁLIDAS do novo estado; se houve Incerto
 *   no meio da sequência, precisa de `confirmacoesComIncerto` (3). Incerto nunca conta.
 * - Cancelamento: leitura válida do estado atual zera a sequência; leitura do estado
 *   oposto ao candidato reinicia a sequência com esse novo candidato (contagem 1).
 * - Incerto não zera a evidência: ela só expira se passar mais de `janelaEvidenciaMs`
 *   desde a última leitura válida do candidato, ou se vier leitura do estado atual/oposto.
 * - `incertosParaIncerto` Incertos seguidos levam o confirmado a Incerto (perda de imagem).
 * - `permanenciaMinMs` impede troca oposta logo após uma confirmação (anti-alternância).
 * Por que 8 s: cobre até 7 Incertos entre duas leituras válidas (imagem intermitente)
 * e expira antes dos 10 s que derrubam o estado para Incerto; fica bem abaixo do alerta
 * (tolerância ≥ 20 s), então o atraso não esconde alerta. Mais curto volta a prender
 * aberturas com imagem ruim; mais longo junta leituras isoladas distantes (falso aberto).
 */
export type ConfigConfirmacaoV2 = {
  confirmacoes: number;
  confirmacoesComIncerto: number;
  janelaEvidenciaMs: number;
  incertosParaIncerto: number;
  permanenciaMinMs: number;
};
export const CONFIRMACAO_V2: ConfigConfirmacaoV2 = { confirmacoes: 2, confirmacoesComIncerto: 3, janelaEvidenciaMs: 8000, incertosParaIncerto: 10, permanenciaMinMs: 3000 };

export type ConfirmacaoV2 = {
  confirmado: EstadoV2;
  candidato: "aberto" | "fechado" | null;
  contagem: number;
  incertosSeguidos: number;
  desdeMs: number | null;
  /** Hora da última leitura válida do candidato. */
  ultimaEvidenciaMs?: number | null;
  /** Houve Incerto entre leituras válidas da sequência atual. */
  comIncerto?: boolean;
};
export const CONFIRMACAO_INICIAL_V2: ConfirmacaoV2 = { confirmado: "incerto", candidato: null, contagem: 0, incertosSeguidos: 0, desdeMs: null, ultimaEvidenciaMs: null, comIncerto: false };

/** Avança uma leitura visual. Não recebe movimento: ausência de movimento nunca prova estado. */
export function confirmarV2(s: ConfirmacaoV2, visual: EstadoV2, agoraMs: number, cfg: ConfigConfirmacaoV2 = CONFIRMACAO_V2): ConfirmacaoV2 {
  const expirou = s.candidato !== null && (s.ultimaEvidenciaMs == null || agoraMs - s.ultimaEvidenciaMs > cfg.janelaEvidenciaMs);
  const base: ConfirmacaoV2 = expirou ? { ...s, candidato: null, contagem: 0, ultimaEvidenciaMs: null, comIncerto: false } : s;
  if (visual === "incerto") {
    const inc = base.incertosSeguidos + 1;
    const n: ConfirmacaoV2 = { ...base, incertosSeguidos: inc, comIncerto: base.candidato !== null ? true : false };
    if (inc >= cfg.incertosParaIncerto && base.confirmado !== "incerto") {
      return { ...n, confirmado: "incerto", candidato: null, contagem: 0, ultimaEvidenciaMs: null, comIncerto: false, desdeMs: agoraMs };
    }
    return n;
  }
  if (visual === base.confirmado) return { ...base, candidato: null, contagem: 0, incertosSeguidos: 0, ultimaEvidenciaMs: null, comIncerto: false };
  const continua = base.candidato === visual;
  const contagem = continua ? base.contagem + 1 : 1;
  const comIncerto = continua ? Boolean(base.comIncerto) : false;
  const exigidas = Math.max(1, comIncerto ? cfg.confirmacoesComIncerto : cfg.confirmacoes);
  const permaneceu = base.confirmado === "incerto" || base.desdeMs === null || agoraMs - base.desdeMs >= cfg.permanenciaMinMs;
  if (contagem >= exigidas && permaneceu) {
    return { confirmado: visual, candidato: null, contagem: 0, incertosSeguidos: 0, desdeMs: agoraMs, ultimaEvidenciaMs: null, comIncerto: false };
  }
  return { ...base, candidato: visual, contagem, incertosSeguidos: 0, ultimaEvidenciaMs: agoraMs, comIncerto };
}

/** Alerta separado: só olha o estado confirmado. */
export function alertaV2(s: ConfirmacaoV2, agoraMs: number, toleranciaSegundos: number): { tempoAbertoSegundos: number; alerta: boolean } {
  if (s.confirmado !== "aberto" || s.desdeMs === null) return { tempoAbertoSegundos: 0, alerta: false };
  const t = Math.max(0, Math.floor((agoraMs - s.desdeMs) / 1000));
  return { tempoAbertoSegundos: t, alerta: t >= toleranciaSegundos };
}

export function textoConfirmacaoV2(s: ConfirmacaoV2, cfg: ConfigConfirmacaoV2 = CONFIRMACAO_V2): string {
  const nome = (e: EstadoV2) => (e === "aberto" ? "Aberto" : e === "fechado" ? "Fechado" : "Incerto");
  if (s.candidato) return `${s.contagem}/${s.comIncerto ? cfg.confirmacoesComIncerto : cfg.confirmacoes} leituras para confirmar ${nome(s.candidato)}${s.incertosSeguidos ? ` (${s.incertosSeguidos} incerta(s) no meio; evidência vale ${cfg.janelaEvidenciaMs / 1000} s)` : ""}; mantém ${nome(s.confirmado)}.`;
  if (s.confirmado === "incerto") return `Aguardando ${cfg.confirmacoes} leituras iguais.`;
  return `Confirmado: ${nome(s.confirmado)}.`;
}
