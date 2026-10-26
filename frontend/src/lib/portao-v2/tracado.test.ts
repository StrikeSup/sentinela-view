import { describe, expect, it } from "vitest";
import { ALT_GRADES, LARG_GRADES, barras } from "@/lib/portao-grades";
import { barrasV2, espacoMaxV2 } from "./tracado";

function grade(passo: number, de: number, ate: number) {
  const v = new Float32Array(LARG_GRADES * ALT_GRADES).fill(200);
  for (let y = 0; y < ALT_GRADES; y++) for (let x = de; x <= ate; x += passo) { v[y * LARG_GRADES + x] = 20; v[y * LARG_GRADES + x + 1] = 20; }
  return v;
}

describe("traçado 2.0", () => {
  it("passo 18 (contorno menor): 2.0 acompanha até o fim, 1.0 não", () => {
    const v = grade(18, 6, 186);
    expect(barras(v).length).toBe(0);
    const b = barrasV2(v);
    expect(b[0]).toBeLessThanOrEqual(8);
    expect(b[b.length - 1]).toBeGreaterThanOrEqual(184);
  });
  it("passo aprendido define o limite", () => expect(espacoMaxV2([], 13.7)).toBe(22));
  it("passo pequeno mantém 14", () => expect(espacoMaxV2([0, 5, 10, 15, 20])).toBe(14));
});
