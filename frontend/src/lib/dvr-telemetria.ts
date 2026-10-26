/** Telemetria de HD e relógio do DVR (Agent Windows v43). Função pura, sem fuso. */
export type TelemetriaDvr = {
  status_hd?: string | null;
  data_hora_dvr?: string | null;
  dados_dvr_atualizados_em?: string | null;
};

const LIMITE_DESATUALIZADO_MS = 5 * 60 * 1000;

/** "2026-10-07T15:11:40" -> "07/10/2026 15:11:40" sem converter fuso. */
export function formatarHoraDvr(v?: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

function idade(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export function linhasTelemetriaDvr(t: TelemetriaDvr, agora = Date.now()): string[] {
  const coleta = t.dados_dvr_atualizados_em ? new Date(t.dados_dvr_atualizados_em).getTime() : NaN;
  const temColeta = Number.isFinite(coleta);
  const desatualizado = temColeta && agora - coleta > LIMITE_DESATUALIZADO_MS;
  const hd = t.status_hd?.trim() || "Indisponível";
  const hora = formatarHoraDvr(t.data_hora_dvr);
  const linhas = [
    `HD: ${hd}`,
    `Data e hora: ${hora ? `${hora} (relógio do DVR)` : "Indisponível"}`,
  ];
  if (!temColeta) linhas.push("Consulta do DVR: Indisponível");
  else
    linhas.push(
      `Consulta do DVR: há ${idade(agora - coleta)}${desatualizado ? " — desatualizada" : ""}`,
    );
  return linhas;
}

export type DiagnosticoDvr = {
  estado: "sem_dados" | "ok" | "problema";
  problemas: string[];
};

const TOLERANCIA_HORA_MS = 3 * 60 * 1000;
const PALAVRAS_HD_RUIM =
  /(erro|error|falha|fail|bad|ausente|sem hd|sem disco|no disk|nenhum|n[aã]o encontrado|not found|corromp|corrupt|cheio|full|abnormal|anormal|unformat|n[aã]o formatado|offline|smart)/i;
const PALAVRAS_HD_OK = /^(ok|normal|bom|good|healthy|saud[aá]vel)\b/i;

/** true = HD com problema; false = HD ok; null = sem informação de HD. Função pura. */
export function hdComProblema(status?: string | null): boolean | null {
  const hd = status?.trim() || "";
  if (!hd) return null;
  return !PALAVRAS_HD_OK.test(hd) && PALAVRAS_HD_RUIM.test(hd);
}

/** Relógio que o DVR deveria mostrar no instante `ms`, no fuso dado, como "naive" em ms. */
function relogioEsperado(ms: number, fuso: string): number | null {
  try {
    const p: Record<string, string> = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: fuso, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
    );
    const n = (k: string) => Number(p[k] ?? 0);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  } catch {
    return null;
  }
}

function relogioDvrNaive(v?: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}

/** Diagnóstico resumido: HD com problema / hora incorreta / ok. Função pura. */
export function diagnosticoDvr(
  t: TelemetriaDvr & { fuso_horario?: string | null },
): DiagnosticoDvr {
  const hd = t.status_hd?.trim() || "";
  const coleta = t.dados_dvr_atualizados_em ? new Date(t.dados_dvr_atualizados_em).getTime() : NaN;
  if (!hd && !t.data_hora_dvr) return { estado: "sem_dados", problemas: [] };
  const problemas: string[] = [];
  if (hdComProblema(hd)) problemas.push("HD com problema");
  const dvr = relogioDvrNaive(t.data_hora_dvr);
  if (dvr !== null && Number.isFinite(coleta)) {
    const esperado = relogioEsperado(coleta, t.fuso_horario || "America/Sao_Paulo");
    if (esperado !== null && Math.abs(dvr - esperado) > TOLERANCIA_HORA_MS) problemas.push("Hora incorreta");
  }
  return { estado: problemas.length ? "problema" : "ok", problemas };
}
