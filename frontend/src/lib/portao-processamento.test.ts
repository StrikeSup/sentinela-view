import { describe, expect, it } from "vitest";
import { OPCOES_PADRAO, clahe, decidirSsim, movimentoPct, opcoesEfetivas, ssim, travarPorMovimento } from "./portao-processamento";

const barras = (desloc = 0) => Float32Array.from({ length: 64 * 8 }, (_, i) => ((i % 64) + desloc) % 6 < 2 ? 20 : 200);
const liso = () => new Float32Array(64 * 8).fill(120);

describe("opções do portão", () => {
  it("modo Padrão ignora opções salvas e volta à leitura original", () => {
    expect(opcoesEfetivas(false, { clahe: true, ssim: true, mascara: false })).toEqual(OPCOES_PADRAO);
  });
  it("modo Avançado respeita cada opção salva", () => {
    expect(opcoesEfetivas(true, { clahe: true, grades: false })).toEqual({ ...OPCOES_PADRAO, clahe: true, grades: false });
  });
});

describe("SSIM", () => {
  it("mesma estrutura = 1 e estruturas diferentes ficam baixas", () => {
    expect(ssim(barras(), barras())).toBeCloseTo(1, 5);
    expect(ssim(barras(), liso())).toBeLessThan(0.2);
  });
  it("decide fechado quando as barras batem com a foto fechada", () => {
    expect(decidirSsim(barras(), [barras()], [liso()], 50).estado).toBe("fechado");
  });
});

describe("CLAHE", () => {
  it("espalha o contraste de uma imagem escura", () => {
    const g = Uint8Array.from({ length: 16 * 16 }, (_, i) => (i % 2 ? 10 : 30));
    const o = clahe(g, 16, 16);
    expect(Math.max(...o) - Math.min(...o)).toBeGreaterThan(20);
  });
  it("pixels fora da máscara ficam de fora", () => {
    const m = new Uint8Array(16).fill(1); m[0] = 0;
    expect(Number.isNaN(clahe(new Uint8Array(16).fill(50), 4, 4, m)[0])).toBe(true);
  });
});

describe("trava de movimento", () => {
  it("sem movimento mantém o estado confirmado", () => {
    expect(travarPorMovimento("aberto", "fechado", 1, 1000)).toEqual({ estado: "fechado", travado: true });
  });
  it("com movimento ou após 30 s aceita a leitura", () => {
    expect(travarPorMovimento("aberto", "fechado", 10, 1000).estado).toBe("aberto");
    expect(travarPorMovimento("aberto", "fechado", 1, 30_000).estado).toBe("aberto");
  });
  it("mede movimento entre leituras", () => {
    expect(movimentoPct(barras(), barras())).toBe(0);
    expect(movimentoPct(barras(), barras(3))).toBeGreaterThan(4);
  });
});
