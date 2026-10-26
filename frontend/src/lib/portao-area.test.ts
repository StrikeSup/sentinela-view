import { describe, expect, it } from "vitest";
import { areaDosPontos, mascaraDaArea, pontosDaArea } from "./portao-area";

describe("contorno do portão", () => {
  it("aceita três pontos com caixa e contorno preservados", () => {
    expect(areaDosPontos([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toEqual({
      x: 0, y: 0, w: 1, h: 1, pontos: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    });
  });
  it("não aceita apenas dois pontos", () => {
    expect(areaDosPontos([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
  it("aceita mais de três pontos", () => {
    expect(areaDosPontos([{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 1, y: 1 }, { x: 0, y: 0.8 }])?.pontos).toHaveLength(4);
  });
  it("exclui do teste os pixels fora do triângulo", () => {
    const roi = areaDosPontos([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
    if (!roi) throw new Error("Área inválida");
    expect(Array.from(mascaraDaArea(roi, 2, 2))).toEqual([1, 0, 0, 0]);
  });
  it("mantém as marcações retangulares antigas", () => {
    const roi = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    expect(pontosDaArea(roi)).toHaveLength(4);
    expect(Array.from(mascaraDaArea(roi, 2, 2))).toEqual([1, 1, 1, 1]);
  });
  it("rejeita contorno cruzado", () => {
    expect(areaDosPontos([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBeNull();
  });
});