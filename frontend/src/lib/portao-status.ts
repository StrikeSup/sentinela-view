/** Selo de status do portão: o que o sistema entendeu naquele momento (fonte: leitura do Agent). */

export type SeloPortao = "aberto" | "fechado" | "sem_leitura";

/** Leitura com mais de 2 minutos de idade não é mais "ao vivo" — vira Sem leitura. */
export const LIMITE_LEITURA_MS = 2 * 60 * 1000;
/** Tolerância para leitura com data no futuro (relógio do servidor adiantado). */
const TOLERANCIA_FUTURO_MS = 60 * 1000;

/** Estado confirmado e recente → aberto/fechado; caso contrário → sem_leitura. */
export function seloPortao(
  estado: string | null | undefined,
  estadoEm: string | null | undefined,
  agoraMs: number,
): SeloPortao {
  if (estado !== "aberto" && estado !== "fechado") return "sem_leitura";
  if (!estadoEm) return "sem_leitura";
  const t = Date.parse(estadoEm);
  if (!Number.isFinite(t)) return "sem_leitura";
  if (agoraMs - t > LIMITE_LEITURA_MS) return "sem_leitura";
  if (t - agoraMs > TOLERANCIA_FUTURO_MS) return "sem_leitura";
  return estado;
}

/** Texto de idade da leitura em português: "agora", "há 5 s", "há 2 min", "há 1 h", "há 3 d". */
export function textoIdade(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "agora";
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
