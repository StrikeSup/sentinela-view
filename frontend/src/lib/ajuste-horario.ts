// Regras compartilhadas do ajuste de horário do DVR (sem dependências de servidor).
export const FUSO_PADRAO = "America/Sao_Paulo";
export const PRAZO_AGENT_MS = 2 * 60 * 1000;
/** Pedido nunca entregue ao Agent expira após este tempo. */
export const PRAZO_ENTREGA_MS = 10 * 60 * 1000;

export const FUSOS_BRASIL: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo, Sul, Sudeste, GO, DF)" },
  { value: "America/Bahia", label: "Bahia" },
  { value: "America/Fortaleza", label: "Fortaleza (CE, RN, PB, PI, MA)" },
  { value: "America/Recife", label: "Recife (PE)" },
  { value: "America/Maceio", label: "Maceió (AL, SE)" },
  { value: "America/Belem", label: "Belém (PA, AP)" },
  { value: "America/Araguaina", label: "Araguaína (TO)" },
  { value: "America/Santarem", label: "Santarém (oeste do PA)" },
  { value: "America/Cuiaba", label: "Cuiabá (MT)" },
  { value: "America/Campo_Grande", label: "Campo Grande (MS)" },
  { value: "America/Manaus", label: "Manaus (AM)" },
  { value: "America/Porto_Velho", label: "Porto Velho (RO)" },
  { value: "America/Boa_Vista", label: "Boa Vista (RR)" },
  { value: "America/Rio_Branco", label: "Rio Branco (AC)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
];

/** Identificador IANA válido (rejeita deslocamentos fixos como -04:00). */
export function fusoValido(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(fuso)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

export type EstadoAjuste = "pendente" | "concluido" | "falhou" | "expirado";
export const ROTULO_ESTADO: Record<EstadoAjuste, string> = {
  pendente: "Pendente",
  concluido: "Concluído",
  falhou: "Falhou",
  expirado: "Expirado",
};

export type ModoAjuste = "ntp" | "manual";

/** Hora local do DVR "yyyy-MM-ddTHH:mm:ss", sem fuso, ano 2000–2099 e data real. */
export function horarioManualValido(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const [a, me, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (h > 23 || mi > 59 || s > 59) return false;
  const dt = new Date(Date.UTC(a, me - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d;
}

/** Valida o pedido do operador. Retorna mensagem de erro ou os dados normalizados. */
export function validarPedidoAjuste(
  body: unknown,
): { erro: string } | { modo: ModoAjuste; fuso_horario: string; horario_manual: string | null } {
  const b = (body ?? {}) as { modo?: unknown; fuso_horario?: unknown; horario_manual?: unknown };
  const modo = b.modo === undefined ? "ntp" : b.modo;
  if (modo !== "ntp" && modo !== "manual") return { erro: "Modo inválido" };
  if (!fusoValido(b.fuso_horario)) return { erro: "Fuso horário inválido" };
  if (modo === "manual") {
    if (!horarioManualValido(b.horario_manual)) return { erro: "Data e hora inválidas" };
    return { modo, fuso_horario: b.fuso_horario, horario_manual: b.horario_manual };
  }
  return { modo, fuso_horario: b.fuso_horario, horario_manual: null };
}

/** Confere se o resultado do Agent corresponde ao pedido armazenado. */
export function resultadoConfere(
  pedido: { modo: ModoAjuste; fuso_horario: string },
  r: { modo?: string | null | undefined; fuso_horario?: string | null | undefined },
): boolean {
  if (r.modo && r.modo !== pedido.modo) return false;
  if (r.fuso_horario && r.fuso_horario !== pedido.fuso_horario) return false;
  return true;
}
