import { describe, expect, it } from "vitest";
import { ancorarValidado, pitchDominanteV2 } from "./ritmo";
import { perfilMedio } from "../portao-periodicidade";
import { decidirComAnterior } from "./anterior";
import type { DecisaoV2 } from "./fusao";
import type { SinaisV2 } from "./ritmo";

const L = 192, A = 64;
function img(f: (x: number, y: number) => number) {
  const v = new Float32Array(L * A);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) v[y * L + x] = f(x, y);
  return v;
}
let s = 7;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
const barras = (passo: number, ruido = 0) => img((x) => (x % passo < 2 ? 30 : 160) + rnd() * ruido);
const rampa = () => img((x) => 40 + 180 * Math.abs(Math.sin((x / L) * Math.PI * 1.5)));
const ruido = () => img(() => 120 + rnd() * 60);

describe("Etapa G4 — passo validado por autocorrelação", () => {
  it("barras reais: passo 6 com autocorrelação alta", () => {
    const p = pitchDominanteV2(perfilMedio(barras(6, 10), L, A));
    expect(p.valido).toBe(true);
    expect(Math.round(p.pitch)).toBe(6);
    expect(p.autocorr).toBeGreaterThan(0.6);
  });
  it("rampa de iluminação não vira passo de barras", () => {
    expect(pitchDominanteV2(perfilMedio(rampa(), L, A)).valido).toBe(false);
  });
  it("referências com espaçamentos diferentes: a destoante é rejeitada, sem apagar nada", () => {
    const refs = [barras(6, 5), barras(6, 8), barras(10, 5)];
    const r = ancorarValidado(refs, L, A);
    expect(refs).toHaveLength(3);
    expect(r.diagnostico.map((d) => d.aceita)).toEqual([true, true, false]);
    expect(r.diagnostico[2]!.motivo).toBe("passo_destoante");
  });
  it("sem referências válidas: sem âncora", () => {
    expect(ancorarValidado([], L, A).ancora).toBeNull();
    expect(ancorarValidado([img(() => 120)], L, A).ancora).toBeNull();
  });
});

describe("Etapa G4 — demonstração da histerese (sem alterar)", () => {
  const n = (x: number): SinaisV2 => ({ periodicidade: x, densidade: x, ssim: x, pitch: 6, qualidade: 1, cobertura: 0.9, continuidade: 0.9 });
  it("G6: Aberto seguido de faixa intermediária com estrutura de portão inteiro não fica preso (vira Incerto)", () => {
    let u: DecisaoV2 | null = decidirComAnterior(n(0.4), 50, null);
    for (let i = 0; i < 1000; i++) u = decidirComAnterior(n(0.6), 50, u);
    expect(u!.estado).toBe("incerto");
  });
  it("basta uma nota ≥ 65% para sair do Aberto preso", () => {
    let u: DecisaoV2 | null = decidirComAnterior(n(0.4), 50, null);
    u = decidirComAnterior(n(0.6), 50, u);
    expect(decidirComAnterior(n(0.66), 50, u).estado).toBe("fechado");
  });
});
