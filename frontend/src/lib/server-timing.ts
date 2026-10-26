/**
 * Cronômetro para o cabeçalho Server-Timing. Só leva nomes fixos e
 * durações numéricas — nunca IDs, tokens ou textos vindos da requisição.
 */
export function cronometro() {
  const inicio = performance.now();
  let marca = inicio;
  const etapas: Array<[string, number]> = [];
  return {
    /** Registra a duração desde a última marca com um nome fixo. */
    etapa(nome: string) {
      const agora = performance.now();
      etapas.push([nome, agora - marca]);
      marca = agora;
    },
    /** Acrescenta o cabeçalho (com "total") e devolve a própria resposta. */
    aplicar(res: Response): Response {
      const partes = [...etapas, ["total", performance.now() - inicio] as [string, number]]
        .filter(([n]) => /^[a-z_]+$/.test(n))
        .map(([n, ms]) => `${n};dur=${ms.toFixed(1)}`);
      try {
        res.headers.set("Server-Timing", partes.join(", "));
      } catch {
        /* cabeçalhos imutáveis: segue sem instrumentação */
      }
      return res;
    },
  };
}

/** Lê Server-Timing no navegador; aceita apenas nome + número. */
export function lerServerTiming(valor: string | null): Record<string, number> | undefined {
  if (!valor) return undefined;
  const out: Record<string, number> = {};
  for (const parte of valor.split(",")) {
    const m = /^\s*([a-z_]{1,40})\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)\s*$/.exec(parte);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return Object.keys(out).length ? out : undefined;
}
