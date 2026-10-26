import { describe, expect, it } from "vitest";
import { fusoValido } from "./ajuste-horario";

describe("fusoValido", () => {
  it("aceita IANA", () => {
    for (const f of ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco", "America/New_York"])
      expect(fusoValido(f)).toBe(true);
  });
  it("rejeita inválidos", () => {
    for (const f of ["-04:00", "UTC-3", "America/Nada_Existe", "", null, 3])
      expect(fusoValido(f)).toBe(false);
  });
});

import { horarioManualValido, validarPedidoAjuste, resultadoConfere } from "./ajuste-horario";

describe("horário manual", () => {
  it("aceita formato local com segundos", () => {
    expect(horarioManualValido("2026-10-08T13:42:17")).toBe(true);
  });
  it("rejeita fuso, ano fora, data impossível", () => {
    for (const v of ["2026-10-08T13:42:17Z", "2026-10-08T13:42:17-03:00", "1999-01-01T00:00:00", "2100-01-01T00:00:00", "2026-02-30T10:00:00", "2026-10-08T24:00:00", "2026-10-08T13:42"])
      expect(horarioManualValido(v)).toBe(false);
  });
  it("pedido manual exige horário; NTP não leva horário", () => {
    expect(validarPedidoAjuste({ modo: "manual", fuso_horario: "America/Manaus" })).toEqual({ erro: "Data e hora inválidas" });
    expect(validarPedidoAjuste({ modo: "ntp", fuso_horario: "America/Manaus", horario_manual: "2026-10-08T13:42:17" })).toEqual({ modo: "ntp", fuso_horario: "America/Manaus", horario_manual: null });
    expect(validarPedidoAjuste({ fuso_horario: "-04:00" })).toEqual({ erro: "Fuso horário inválido" });
  });
  it("resultado com modo ou fuso diferente do pedido é recusado", () => {
    const p = { modo: "manual" as const, fuso_horario: "America/Manaus" };
    expect(resultadoConfere(p, { modo: "manual", fuso_horario: "America/Manaus" })).toBe(true);
    expect(resultadoConfere(p, { modo: "ntp", fuso_horario: "America/Manaus" })).toBe(false);
    expect(resultadoConfere(p, { modo: "manual", fuso_horario: "America/Sao_Paulo" })).toBe(false);
  });
});
