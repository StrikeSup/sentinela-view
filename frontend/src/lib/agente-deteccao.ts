/**
 * Lista de trabalho para análise de quadros no Agent.
 *
 * O Agent não usa eventos de movimento do DVR: ele analisa os próprios
 * quadros do vídeo local. Para não processar todas as câmeras, o GET
 * /api/public/agente devolve `cameras_deteccao_ativas` com apenas as linhas
 * `cameras_deteccao.ativo = true` dos DVRs ativos atribuídos àquele servidor,
 * junto com a grade, a sensibilidade e as células ignoradas de cada câmera.
 */

export type CameraDeteccaoAtiva = {
  dvr_id: string;
  canal: number;
  colunas: number;
  linhas: number;
  sensibilidade: number;
  ignorados: number[];
};

export type LinhaCameraDeteccao = {
  dvr_id: unknown;
  canal: unknown;
  colunas?: unknown;
  linhas?: unknown;
  sensibilidade?: unknown;
  ignorados?: unknown;
};

import { GRADE_COLUNAS, GRADE_LINHAS, remapearIgnorados } from "./deteccao-grade";

export const CANAL_MIN = 1;
export const CANAL_MAX = 512;

/** Grade de origem assumida para linhas antigas sem colunas/linhas válidas
 * (default antigo da tabela `cameras_deteccao`). */
export const COLUNAS_PADRAO = 22;
export const LINHAS_PADRAO = 18;
export const SENSIBILIDADE_PADRAO = 50;
export const SENSIBILIDADE_MIN = 1;
export const SENSIBILIDADE_MAX = 100;
/** Teto de segurança para a grade (evita listas/grades absurdas). */
export const GRADE_MAX = 256;

function inteiro(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

function normalizarGrade(v: unknown, padrao: number): number {
  const n = inteiro(v);
  return n !== null && n >= 1 && n <= GRADE_MAX ? n : padrao;
}

function normalizarSensibilidade(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return SENSIBILIDADE_PADRAO;
  return Math.min(SENSIBILIDADE_MAX, Math.max(SENSIBILIDADE_MIN, Math.round(n)));
}

/** Índices válidos (0..colunas*linhas-1), sem duplicatas, em ordem crescente. */
function normalizarIgnorados(v: unknown, total: number): number[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<number>();
  for (const item of v) {
    const n = inteiro(item);
    if (n !== null && n >= 0 && n < total) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Filtra as linhas de detecção ativas para os DVRs do servidor.
 * - `dvrIds`: ids dos DVRs ativos atribuídos ao servidor (isolamento).
 * - `linhas`: linhas `cameras_deteccao` já filtradas por ativo=true no banco.
 * Linhas com dvr fora da lista do servidor ou canal fora de 1..512 caem fora.
 * Campos de configuração inválidos voltam ao padrão compatível.
 */
export function selecionarCamerasDeteccao(
  dvrIds: string[],
  linhas: LinhaCameraDeteccao[],
): CameraDeteccaoAtiva[] {
  const permitidos = new Set(dvrIds.map((id) => id.toLowerCase()));
  const vistos = new Set<string>();
  const saida: CameraDeteccaoAtiva[] = [];
  for (const l of linhas) {
    if (typeof l.dvr_id !== "string") continue;
    const dvrId = l.dvr_id.toLowerCase();
    if (!permitidos.has(dvrId)) continue;
    const canal = typeof l.canal === "number" ? l.canal : Number(l.canal);
    if (!Number.isInteger(canal) || canal < CANAL_MIN || canal > CANAL_MAX) continue;
    const chave = `${dvrId}:${canal}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const colunas = normalizarGrade(l.colunas, COLUNAS_PADRAO);
    const nLinhas = normalizarGrade(l.linhas, LINHAS_PADRAO);
    // Sempre envia na grade padrão 32x24 (a mesma da tela Detecção),
    // remapeando por área máscaras salvas em outra grade.
    saida.push({
      dvr_id: dvrId,
      canal,
      colunas: GRADE_COLUNAS,
      linhas: GRADE_LINHAS,
      sensibilidade: normalizarSensibilidade(l.sensibilidade),
      ignorados: remapearIgnorados(
        normalizarIgnorados(l.ignorados, colunas * nLinhas),
        colunas,
        nLinhas,
      ),
    });
  }
  return saida;
}

/**
 * Resultado da consulta `cameras_deteccao` no banco:
 * `erro: true` = falha da consulta (ex.: banco indisponível), não "nada ativo".
 */
export type ConsultaCamerasDeteccao =
  | { erro: true }
  | { erro: false; linhas: LinhaCameraDeteccao[] };

export type ResultadoCamerasDeteccao = { ok: false } | { ok: true; cameras: CameraDeteccaoAtiva[] };

/**
 * Decide a lista de trabalho a partir do resultado da consulta.
 * Uma falha da consulta NÃO vira lista vazia: devolvemos `ok: false` para o
 * chamador responder 503 e o Agent manter a configuração anterior.
 */
export function resolverCamerasDeteccao(
  dvrIds: string[],
  consulta: ConsultaCamerasDeteccao,
): ResultadoCamerasDeteccao {
  if (consulta.erro) return { ok: false };
  return { ok: true, cameras: selecionarCamerasDeteccao(dvrIds, consulta.linhas) };
}
