import { describe, expect, it } from "vitest";
import { canaisConfigurados, diasGravados, mediaDias } from "./discos-gravacoes";

describe("resumos dos discos", () => {
  it("conta apenas câmeras configuradas para gravação", () => {
    expect(canaisConfigurados({ id: "d", nome: "DVR", canais: 8, canais_gravacao: [2, 4, 4, 9], dias_backup: 7 })).toEqual([2, 4]);
  });
  it("inclui todos os canais quando a gravação de todos está habilitada", () => {
    expect(canaisConfigurados({ id: "d", nome: "DVR", canais: 3, canais_gravacao: [], gravar_todos_canais: true, dias_backup: 7 })).toEqual([1, 2, 3]);
  });
  it("calcula a média individual das câmeras, incluindo dias zero", () => {
    expect(mediaDias([2, 0, 4])).toBe(2);
    expect(mediaDias([])).toBeNull();
  });
  it("não conta lacunas nem sobreposição como dias gravados", () => {
    const trecho = (inicio: string, fim: string) => ({ dvr_id: "d", canal: 1, camera_nome: null, inicio, fim, duracao_segundos: null });
    expect(diasGravados([
      trecho("2026-01-01T00:00:00Z", "2026-01-01T12:00:00Z"),
      trecho("2026-01-01T06:00:00Z", "2026-01-01T18:00:00Z"),
      trecho("2026-01-03T00:00:00Z", "2026-01-03T06:00:00Z"),
    ])).toBe(1);
  });
});