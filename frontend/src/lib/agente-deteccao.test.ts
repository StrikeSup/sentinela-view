import { describe, it, expect } from "vitest";
import { selecionarCamerasDeteccao, resolverCamerasDeteccao } from "./agente-deteccao";

const DVR_A = "11111111-1111-1111-1111-111111111111";
const DVR_B = "22222222-2222-2222-2222-222222222222";
const DVR_OUTRO_SERVIDOR = "33333333-3333-3333-3333-333333333333";

const PADRAO = { colunas: 32, linhas: 24, sensibilidade: 50, ignorados: [] as number[] };
const ids = (r: { dvr_id: string; canal: number }[]) => r.map(({ dvr_id, canal }) => ({ dvr_id, canal }));

describe("selecionarCamerasDeteccao", () => {
  it("seleciona apenas câmeras ativas dos DVRs do servidor", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A, DVR_B],
      [
        { dvr_id: DVR_A, canal: 1 },
        { dvr_id: DVR_A, canal: 3 },
        { dvr_id: DVR_B, canal: 2 },
      ],
    );
    expect(ids(r)).toEqual([
      { dvr_id: DVR_A, canal: 1 },
      { dvr_id: DVR_A, canal: 3 },
      { dvr_id: DVR_B, canal: 2 },
    ]);
  });

  it("devolve lista vazia explícita quando nada está ativo", () => {
    expect(selecionarCamerasDeteccao([DVR_A], [])).toEqual([]);
    expect(selecionarCamerasDeteccao([], [])).toEqual([]);
  });

  it("isola servidores: ignora linhas de DVRs não atribuídos", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [
        { dvr_id: DVR_A, canal: 1 },
        { dvr_id: DVR_OUTRO_SERVIDOR, canal: 1 },
        { dvr_id: DVR_OUTRO_SERVIDOR, canal: 9 },
      ],
    );
    expect(ids(r)).toEqual([{ dvr_id: DVR_A, canal: 1 }]);
  });

  it("valida canal no intervalo 1..512", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [0, 1, 512, 513, -2, 1.5, Number.NaN].map((canal) => ({ dvr_id: DVR_A, canal })),
    );
    expect(ids(r)).toEqual([
      { dvr_id: DVR_A, canal: 1 },
      { dvr_id: DVR_A, canal: 512 },
    ]);
  });

  it("ignora linhas sem dvr_id válido e normaliza o id para minúsculas", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [
        { dvr_id: DVR_A.toUpperCase(), canal: 4 },
        { dvr_id: null, canal: 1 },
        { dvr_id: 42, canal: 1 },
        { dvr_id: "", canal: 1 },
      ],
    );
    expect(ids(r)).toEqual([{ dvr_id: DVR_A, canal: 4 }]);
  });

  it("não duplica a mesma câmera se houver linha repetida", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [
        { dvr_id: DVR_A, canal: 1 },
        { dvr_id: DVR_A, canal: 1 },
      ],
    );
    expect(r).toHaveLength(1);
  });

  it("inclui colunas, linhas, sensibilidade e ignorados válidos", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [{ dvr_id: DVR_A, canal: 2, colunas: 32, linhas: 24, sensibilidade: 70, ignorados: [3, 0, 767] }],
    );
    expect(r).toEqual([
      { dvr_id: DVR_A, canal: 2, colunas: 32, linhas: 24, sensibilidade: 70, ignorados: [0, 3, 767] },
    ]);
  });

  it("campos ausentes usam os padrões compatíveis", () => {
    const r = selecionarCamerasDeteccao([DVR_A], [{ dvr_id: DVR_A, canal: 1 }]);
    expect(r).toEqual([{ dvr_id: DVR_A, canal: 1, ...PADRAO }]);
  });

  it("limita sensibilidade a 1..100 e usa padrão para valor não numérico", () => {
    const s = (v: unknown) =>
      selecionarCamerasDeteccao([DVR_A], [{ dvr_id: DVR_A, canal: 1, sensibilidade: v }])[0]!
        .sensibilidade;
    expect(s(0)).toBe(1);
    expect(s(-10)).toBe(1);
    expect(s(150)).toBe(100);
    expect(s(42.6)).toBe(43);
    expect(s("abc")).toBe(50);
    expect(s(null)).toBe(50);
    expect(s(Number.POSITIVE_INFINITY)).toBe(50);
  });

  it("sempre envia grade 32x24, mesmo com colunas/linhas inválidas", () => {
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [
        { dvr_id: DVR_A, canal: 1, colunas: 0, linhas: -3 },
        { dvr_id: DVR_A, canal: 2, colunas: 2.5, linhas: "x" },
        { dvr_id: DVR_A, canal: 3, colunas: 100000, linhas: 4 },
      ],
    );
    expect(r.map((c) => [c.colunas, c.linhas])).toEqual([
      [32, 24],
      [32, 24],
      [32, 24],
    ]);
  });

  it("linha antiga 22x18 é remapeada para 32x24 (ativo/sensibilidade preservados)", () => {
    // 22x18 com a linha 0 inteira ignorada => topo de 32x24 (linha 0) ignorado
    const linha0 = Array.from({ length: 22 }, (_, i) => i);
    const r = selecionarCamerasDeteccao(
      [DVR_A],
      [{ dvr_id: DVR_A, canal: 1, colunas: 22, linhas: 18, sensibilidade: 80, ignorados: linha0 }],
    )[0]!;
    expect(r.colunas).toBe(32);
    expect(r.linhas).toBe(24);
    expect(r.sensibilidade).toBe(80);
    expect(r.ignorados).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it("linha antiga sem colunas/linhas assume 22x18 e remapeia", () => {
    const r = selecionarCamerasDeteccao([DVR_A], [{ dvr_id: DVR_A, canal: 1, ignorados: [0] }])[0]!;
    // célula 0 de 22x18 cobre ~1,45x1,33 células de 32x24 => só a célula 0
    expect(r.ignorados).toEqual([0]);
  });

  it("ignorados: descarta não-array, fora da grade, negativos, não inteiros e duplicados", () => {
    const g = (v: unknown) =>
      selecionarCamerasDeteccao(
        [DVR_A],
        [{ dvr_id: DVR_A, canal: 1, colunas: 32, linhas: 24, ignorados: v }],
      )[0]!.ignorados;
    expect(g("1,2")).toEqual([]);
    expect(g({ 0: 1 })).toEqual([]);
    expect(g(null)).toEqual([]);
    expect(g([7, 768, -1, 1.5, "2", null, 2, 7])).toEqual([2, 7]);
  });
});

describe("resolverCamerasDeteccao", () => {
  it("falha da consulta NÃO devolve lista vazia: sinaliza erro para responder 503", () => {
    expect(resolverCamerasDeteccao([DVR_A], { erro: true })).toEqual({ ok: false });
  });

  it("consulta bem-sucedida sem linhas devolve lista vazia explícita", () => {
    expect(resolverCamerasDeteccao([DVR_A], { erro: false, linhas: [] })).toEqual({
      ok: true,
      cameras: [],
    });
  });
});
