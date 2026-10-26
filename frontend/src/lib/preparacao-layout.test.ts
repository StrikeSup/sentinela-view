import { describe, expect, it } from "vitest";
import { montarPreconexao } from "./preparacao-layout";

const dvr = "3211ac1e-bca1-486f-8386-8f2c2a12ea18";

describe("montarPreconexao", () => {
  it("prioriza os canais do layout ativo e remove duplicatas", () => {
    const result = montarPreconexao(
      [{ id: dvr, canais: 40, preconectar_ate: "2026-10-11T12:10:00Z" }],
      [
        { dvr_id: dvr, canal: 7, expira_em: "2026-10-11T12:02:00Z" },
        { dvr_id: dvr, canal: 2, expira_em: "2026-10-11T12:03:00Z" },
        { dvr_id: dvr, canal: 7, expira_em: "2026-10-11T12:04:00Z" },
      ],
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(result).toEqual([{ dvr_id: dvr, canais: [2, 7], ate: "2026-10-11T12:04:00Z" }]);
  });

  it("entrega lista de canais para clientes antigos sem layout ativo", () => {
    const result = montarPreconexao(
      [{ id: dvr, canais: 40, preconectar_ate: "2026-10-11T12:05:00Z" }],
      [],
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(result[0]?.canais).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("descarta leases vencidos e canais inválidos", () => {
    expect(
      montarPreconexao(
        [],
        [
          { dvr_id: dvr, canal: 1, expira_em: "2026-10-11T11:59:00Z" },
          { dvr_id: dvr, canal: 0, expira_em: "2026-10-11T12:05:00Z" },
        ],
        new Date("2026-10-11T12:00:00Z"),
      ),
    ).toEqual([]);
  });
});
