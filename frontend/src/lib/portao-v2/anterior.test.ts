import { describe, expect, it } from "vitest";
import { anteriorDaFaixa, decidirComAnterior } from "./anterior";
import { limiaresV2, type DecisaoV2 } from "./fusao";
import type { SinaisV2 } from "./ritmo";

// Sensibilidade 50: Fechado com nota ≥ 65%, Aberto com nota ≤ 45%, faixa intermediária no meio.
// cobertura/continuidade baixas = estrutura de portão aberto (G6 exige evidência para manter Aberto).
const nota = (n: number, qualidade = 1): SinaisV2 => ({ periodicidade: n, densidade: n, ssim: n, pitch: 6, qualidade, cobertura: 0.2, continuidade: 0.2 });
const seq = (notas: number[]) => {
  let ultima: DecisaoV2 | null = null;
  return notas.map((n) => (ultima = decidirComAnterior(nota(n), 50, ultima)).estado);
};

describe("Portão 2.0 — faixa intermediária usa a leitura anterior", () => {
  it("limiares de sensibilidade 50 continuam 65% / 45%", () => {
    const { fechar, abrir } = limiaresV2(50);
    expect(fechar).toBeCloseTo(0.65, 10);
    expect(abrir).toBeCloseTo(0.45, 10);
  });
  it("sem leitura anterior, nota na faixa fica Incerto", () => {
    expect(seq([0.57])).toEqual(["incerto"]);
  });
  it("depois de Fechado, nota na faixa mantém Fechado", () => {
    expect(seq([0.8, 0.57, 0.5])).toEqual(["fechado", "fechado", "fechado"]);
  });
  it("depois de Aberto, nota na faixa mantém Aberto", () => {
    expect(seq([0.2, 0.57, 0.6])).toEqual(["aberto", "aberto", "aberto"]);
  });
  it("notas fora da faixa decidem sozinhas (mudança de estado)", () => {
    expect(seq([0.8, 0.57, 0.3, 0.57, 0.7])).toEqual(["fechado", "fechado", "aberto", "aberto", "fechado"]);
  });
  it("Incerto anterior não é leitura válida: faixa continua Incerto", () => {
    const incerta: DecisaoV2 = { estado: "incerto", nota: 0.55, abertura: 45, confianca: 50, motivo: "", faixa: "intermediaria" };
    expect(decidirComAnterior(nota(0.57), 50, incerta).estado).toBe("incerto");
  });
  it("qualidade baixa anterior invalida a leitura e a qualidade baixa atual sempre dá Incerto", () => {
    const ruim = decidirComAnterior(nota(0.9, 0.2), 50, null);
    expect(ruim.estado).toBe("incerto");
    expect(anteriorDaFaixa(ruim)).toBe("incerto");
    expect(seq([0.8]).concat(decidirComAnterior(nota(0.57, 0.2), 50, { estado: "fechado", nota: 0.8, abertura: 20, confianca: 80, motivo: "", faixa: "fechado" }).estado)).toEqual(["fechado", "incerto"]);
  });
});
