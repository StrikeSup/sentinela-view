import { describe, expect, it } from "vitest";
import { avancarTempo, TEMPO_INICIAL } from "./portao-grades";
import { confirmacaoPortao, motivoPortao } from "./portao-log";

describe("diagnóstico do portão", () => {
  it("explica quando a estimativa substitui a leitura inicial", () => {
    expect(motivoPortao({ estado: "fechado", confianca: 80 }, { abertura: 35, barrasFechado: 20, barrasAtual: 13 })).toContain("prevaleceu");
  });
  it("não atribui a decisão às barras na faixa incerta", () => {
    expect(motivoPortao({ estado: "aberto", confianca: 80, distFechado: 60 }, { abertura: 8, barrasFechado: 20, barrasAtual: 18 })).toContain("sem substituição");
  });
  it("distingue leitura pendente de estado após duas confirmações", () => {
    const cfg = { confirmacoes: 2, alertarAposSegundos: 30 };
    const primeiro = avancarTempo(TEMPO_INICIAL, "aberto", 1000, cfg);
    expect(primeiro.status).toBe("incerto");
    expect(confirmacaoPortao(primeiro)).toContain("1/2");
    const segundo = avancarTempo(primeiro, "aberto", 2000, cfg);
    expect(segundo.status).toBe("aberto");
    expect(confirmacaoPortao(segundo)).toContain("confirmado");
  });
});