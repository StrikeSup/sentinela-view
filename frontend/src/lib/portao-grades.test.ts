import { describe, expect, it } from "vitest";
import { ALT_GRADES, LARG_GRADES, TEMPO_INICIAL, aberturaPorGrades, avancarTempo, estadoPorAbertura } from "./portao-grades";

/** Imagem sintética: barras escuras a cada 8 px entre de..ate. */
function portao(de: number, ate: number) {
  const v = new Float32Array(LARG_GRADES * ALT_GRADES).fill(200);
  for (let y = 0; y < ALT_GRADES; y++) for (let x = de; x <= ate; x += 8) { v[y * LARG_GRADES + x] = 20; v[y * LARG_GRADES + x + 1] = 20; }
  return v;
}

describe("abertura por grades", () => {
  const fechado = portao(10, 170);
  it("fechado ≈ 0%", () => expect(aberturaPorGrades(portao(10, 170), fechado)!.abertura).toBeLessThanOrEqual(5));
  it("metade aberto ≈ 50%", () => {
    const a = aberturaPorGrades(portao(90, 170), fechado)!.abertura;
    expect(a).toBeGreaterThan(40);
    expect(a).toBeLessThan(60);
  });
  it("sem grades = 100%", () => expect(aberturaPorGrades(new Float32Array(LARG_GRADES * ALT_GRADES).fill(150), fechado)!.abertura).toBe(100));
  it("faixas de estado", () => {
    expect(estadoPorAbertura(3)).toBe("fechado");
    expect(estadoPorAbertura(8)).toBe("incerto");
    expect(estadoPorAbertura(30)).toBe("aberto");
  });
});

describe("temporização", () => {
  const cfg = { confirmacoes: 2, alertarAposSegundos: 30 };
  it("confirma após 2 leituras e alerta após 30 s aberto, uma vez", () => {
    let s = avancarTempo(TEMPO_INICIAL, "aberto", 0, cfg);
    expect(s.status).toBe("incerto");
    s = avancarTempo(s, "aberto", 1000, cfg);
    expect(s.status).toBe("aberto");
    s = avancarTempo(s, "aberto", 30_000, cfg);
    expect(s.alertaAtivo).toBe(false);
    s = avancarTempo(s, "aberto", 31_000, cfg);
    expect(s.tempoAbertoSegundos).toBe(30);
    expect(s.novoAlerta).toBe(true);
    s = avancarTempo(s, "aberto", 32_000, cfg);
    expect(s.novoAlerta).toBe(false);
    expect(s.alertaAtivo).toBe(true);
  });
  it("leitura isolada diferente não troca o status", () => {
    let s = avancarTempo(TEMPO_INICIAL, "fechado", 0, cfg);
    s = avancarTempo(s, "fechado", 1000, cfg);
    s = avancarTempo(s, "aberto", 2000, cfg);
    s = avancarTempo(s, "fechado", 3000, cfg);
    expect(s.status).toBe("fechado");
  });
});
