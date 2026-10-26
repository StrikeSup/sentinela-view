import { describe, it, expect } from "vitest";
import { remapearIgnorados, mascaraPadrao } from "./deteccao-grade";

describe("remapearIgnorados", () => {
  it("32x24 permanece idêntica (ordenada e sem duplicatas)", () => {
    expect(remapearIgnorados([5, 0, 767, 5, 800, -1], 32, 24)).toEqual([0, 5, 767]);
  });

  it("máscara 22x18 cheia vira 32x24 cheia; vazia continua vazia", () => {
    const todos22 = Array.from({ length: 22 * 18 }, (_, i) => i);
    expect(remapearIgnorados(todos22, 22, 18)).toHaveLength(32 * 24);
    expect(remapearIgnorados([], 22, 18)).toEqual([]);
  });

  it("metade esquerda em 22x18 vira metade esquerda em 32x24", () => {
    const esq22: number[] = [];
    for (let r = 0; r < 18; r++) for (let c = 0; c < 11; c++) esq22.push(r * 22 + c);
    const esq32: number[] = [];
    for (let r = 0; r < 24; r++) for (let c = 0; c < 16; c++) esq32.push(r * 32 + c);
    expect(remapearIgnorados(esq22, 22, 18)).toEqual(esq32);
  });

  it("canto inferior direito 22x18 aparece no canto de 32x24", () => {
    expect(remapearIgnorados([22 * 18 - 1], 22, 18)).toEqual([32 * 24 - 1]);
  });
});

describe("mascaraPadrao", () => {
  it("registro sem grade assume 22x18 legado", () => {
    expect(mascaraPadrao({ ignorados: [22 * 18 - 1] })).toEqual([767]);
  });
  it("registro 32x24 é mantido", () => {
    expect(mascaraPadrao({ colunas: 32, linhas: 24, ignorados: [10, 3] })).toEqual([3, 10]);
  });
  it("sem registro → vazio", () => {
    expect(mascaraPadrao(null)).toEqual([]);
  });
});
