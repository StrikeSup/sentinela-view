import { describe, expect, it } from "vitest";
import { classificar, cinzaEqualizado, diferenca, grades } from "./portao-navegador";

const v = (x: number) => new Float32Array(100).fill(x);

describe("classificar no navegador", () => {
  it("lê fechado quando parece com a foto fechada", () => {
    expect(classificar(v(10), [v(0)], [v(200)], 50).estado).toBe("fechado");
  });
  it("lê aberto quando parece com a foto aberta", () => {
    expect(classificar(v(190), [v(0)], [v(200)], 50).estado).toBe("aberto");
  });
  it("fica incerto quando está no meio", () => {
    expect(classificar(v(100), [v(0)], [v(200)], 50).estado).toBe("incerto");
  });
  it("sem fotos de um dos lados, incerto", () => {
    expect(classificar(v(0), [v(0)], [], 50).estado).toBe("incerto");
  });
});

const grade = (barras: boolean, ruido = 0) => {
  const a = new Float32Array(64 * 48);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) a[y * 64 + x] = (barras && x % 4 < 2 ? 20 : 200) + ((x * 7 + y * 13) % 5) * ruido;
  return a;
};

describe("grades verticais", () => {
  it("ignora diferenças fora do contorno na equalização e comparação", () => {
    const a = cinzaEqualizado([10, 10, 10, 255, 200, 200, 200, 255], new Uint8Array([1, 0]));
    const b = cinzaEqualizado([10, 10, 10, 255, 0, 0, 0, 255], new Uint8Array([1, 0]));
    expect(diferenca(a, b)).toBe(0);
    expect(Number.isNaN(a[1])).toBe(true);
  });
  it("não cria grades falsas na borda da máscara", () => {
    const v = new Float32Array(64 * 48).fill(100);
    for (let y = 0; y < 48; y++) for (let x = 32; x < 64; x++) v[y * 64 + x] = NaN;
    expect(grades(v)).toBe(0);
  });
  it("lê aberto quando as grades somem, mesmo diferente da foto aberta (carro)", () => {
    const comCarro = grade(false);
    for (let i = 0; i < comCarro.length / 2; i++) comCarro[i] = 60; // carro escuro
    const vazio = grade(false, 3);
    expect(classificar(vazio, [grade(true)], [comCarro], 50).estado).toBe("aberto");
  });
  it("lê fechado com as grades presentes", () => {
    expect(classificar(grade(true, 2), [grade(true)], [grade(false)], 50).estado).toBe("fechado");
  });
});
