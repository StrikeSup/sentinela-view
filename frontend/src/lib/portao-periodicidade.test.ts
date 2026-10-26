import { describe, expect, it } from "vitest";
import { aprenderReferencia, decidirRitmo, pitchDominante, perfilMedio, sinaisRitmo } from "./portao-periodicidade";

const L = 192, A = 64;
/** Cena: fundo com poste e "carro"; grades a cada 6 colunas cobrindo [0, fimGrades). */
function cena(fimGrades: number, ruido = 0, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * ruido;
  const v = new Float32Array(L * A);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    let p = 150;
    if (x >= 150 && x < 154) p = 40; // poste
    if (x >= 90 && x < 130 && y > 30) p = 220; // carro claro
    if (x < fimGrades && x % 6 < 2) p = 30; // barra
    v[y * L + x] = p + rnd();
  }
  return v;
}

describe("portão por periodicidade", () => {
  const ref = aprenderReferencia(cena(L), L, A)!;
  const scoreAberto = sinaisRitmo(cena(0), [ref], L, A)!.score;

  it("aprende o passo das grades da foto fechado (6 colunas)", () => {
    expect(Math.round(pitchDominante(perfilMedio(cena(L), L, A)))).toBe(6);
  });

  it("portão aberto com poste e carro ao fundo não vira fechado", () => {
    const d = decidirRitmo(sinaisRitmo(cena(0), [ref], L, A)!, [scoreAberto], 50);
    expect(d.estado).toBe("aberto");
    expect(d.abertura).toBeGreaterThan(90);
  });

  it("portão com só 15% das grades (recolhido) é aberto", () => {
    const d = decidirRitmo(sinaisRitmo(cena(30), [ref], L, A)!, [scoreAberto], 50);
    expect(d.estado).toBe("aberto");
  });

  it("portão fechado com ruído de chuva continua fechado", () => {
    const d = decidirRitmo(sinaisRitmo(cena(L, 35, 7), [ref], L, A)!, [scoreAberto], 50);
    expect(d.estado).toBe("fechado");
  });

  it("abertura cresce conforme o portão abre", () => {
    const ab = (fim: number) => decidirRitmo(sinaisRitmo(cena(fim), [ref], L, A)!, [scoreAberto], 50).abertura;
    expect(ab(L)).toBeLessThan(ab(120));
    expect(ab(120)).toBeLessThan(ab(40));
  });

  it("foto fechado sem grades não serve de referência", () => {
    expect(aprenderReferencia(new Float32Array(L * A).fill(120), L, A)).toBeNull();
  });
});
