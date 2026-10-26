import { describe, expect, it } from "vitest";
import { resumirAberturaLayout } from "./abertura-layout";

describe("resumirAberturaLayout", () => {
  it("mostra a mediana das câmeras que apresentaram o primeiro quadro", () => {
    expect(resumirAberturaLayout(4, [400, 900, 1200])).toEqual({
      prontas: 3,
      total: 4,
      medianaMs: 900,
    });
    expect(resumirAberturaLayout(2, [])).toEqual({ prontas: 0, total: 2, medianaMs: null });
  });
});
