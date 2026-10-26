import { describe, expect, it } from "vitest";
import { decidirComAnterior } from "./anterior";
import { limiaresV2, type DecisaoV2 } from "./fusao";
import type { SinaisV2 } from "./ritmo";

const { fechar, abrir } = limiaresV2(50);
// Sinais com nota exata = x (pesos somam 1) e estrutura (cobertura, continuidade).
const s = (x: number, cob: number, cont: number): SinaisV2 => ({ periodicidade: x, densidade: x, ssim: x, pitch: 5, cobertura: cob, continuidade: cont, qualidade: 1 });
const ABERTO_ANT = decidirComAnterior(s(0.2, 0.1, 0.1), 50, null);
const FECHADO_ANT = decidirComAnterior(s(0.8, 0.9, 0.9), 50, null);
const INCERTO_ANT: DecisaoV2 = { estado: "incerto", nota: 0.55, abertura: 45, confianca: 50, motivo: "", faixa: "intermediaria" };
const rodar = (sin: SinaisV2, ini: DecisaoV2 | null, n = 50) => {
  let u = ini;
  for (let i = 0; i < n; i++) u = decidirComAnterior(sin, 50, u);
  return u!.estado;
};

describe("G6 — histerese com evidência estrutural", () => {
  it("pré-condição", () => { expect(ABERTO_ANT.estado).toBe("aberto"); expect(FECHADO_ANT.estado).toBe("fechado"); });
  it("fechado (portão inteiro) após Aberto não fica Aberto: vira Incerto", () => expect(rodar(s(0.57, 0.94, 0.94), ABERTO_ANT)).toBe("incerto"));
  it("aberto com cobertura e continuidade < 50% mantém Aberto", () => expect(rodar(s(0.57, 0.3, 0.2), ABERTO_ANT)).toBe("aberto"));
  it("parcial em conflito (só uma abaixo de 50%) → Incerto", () => {
    expect(rodar(s(0.57, 0.3, 0.7), ABERTO_ANT)).toBe("incerto");
    expect(rodar(s(0.57, 0.7, 0.3), ABERTO_ANT)).toBe("incerto");
  });
  it("nunca força Fechado na faixa", () => expect(decidirComAnterior(s(0.64, 1, 1), 50, ABERTO_ANT).estado).not.toBe("fechado"));
  it("Fechado anterior na faixa continua Fechado (inalterado)", () => {
    expect(decidirComAnterior(s(0.57, 0.1, 0.1), 50, FECHADO_ANT).estado).toBe("fechado");
    expect(decidirComAnterior(s(0.57, 0.9, 0.9), 50, FECHADO_ANT).estado).toBe("fechado");
  });
  it("sem anterior válido: Incerto (inalterado)", () => {
    expect(decidirComAnterior(s(0.57, 0.1, 0.1), 50, null).estado).toBe("incerto");
    expect(decidirComAnterior(s(0.57, 0.1, 0.1), 50, INCERTO_ANT).estado).toBe("incerto");
  });
  it("fora da faixa: nota < 45% Aberto e > 65% Fechado, qualquer estrutura", () => {
    expect(decidirComAnterior(s(0.3, 0.9, 0.9), 50, FECHADO_ANT).estado).toBe("aberto");
    expect(decidirComAnterior(s(0.8, 0.1, 0.1), 50, ABERTO_ANT).estado).toBe("fechado");
  });
  it("limite 45%: nota = abrir é Aberto (≤), mesmo sem evidência", () => {
    expect(decidirComAnterior(s(abrir, 0.9, 0.9), 50, null).estado).toBe("aberto");
  });
  it("limite 65%: nota = fechar é Fechado (≥)", () => {
    expect(decidirComAnterior(s(fechar, 0.1, 0.1), 50, ABERTO_ANT).estado).toBe("fechado");
  });
  it("limite 50% da estrutura: exatamente 50% não é evidência (comparação estrita <)", () => {
    expect(decidirComAnterior(s(0.57, 0.5, 0.2), 50, ABERTO_ANT).estado).toBe("incerto");
    expect(decidirComAnterior(s(0.57, 0.2, 0.5), 50, ABERTO_ANT).estado).toBe("incerto");
    expect(decidirComAnterior(s(0.57, 0.4999, 0.4999), 50, ABERTO_ANT).estado).toBe("aberto");
  });
  it("Aberto rebaixado a Incerto não volta a segurar Aberto no quadro seguinte", () => {
    const i = decidirComAnterior(s(0.57, 0.9, 0.9), 50, ABERTO_ANT);
    expect(decidirComAnterior(s(0.57, 0.1, 0.1), 50, i).estado).toBe("incerto");
  });
  it("sinais de estrutura ausentes não contam como evidência", () => {
    expect(decidirComAnterior({ periodicidade: 0.57, densidade: 0.57, ssim: 0.57, pitch: 5, qualidade: 1 }, 50, ABERTO_ANT).estado).toBe("incerto");
  });
});
