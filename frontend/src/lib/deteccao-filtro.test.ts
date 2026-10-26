import { describe, expect, it } from "vitest";

import {
  TODOS_OS_TIPOS,
  camerasDoTipoFiltro,
  chaveCamera,
  indicesPorTipo,
  opcoesDeTipo,
  type DeteccoesPorTipo,
} from "./deteccao-filtro";

const cameras = [
  { dvr_id: "dvr-1", canal: 1, nome: "Entrada" },
  { dvr_id: "dvr-1", canal: 2, nome: "Portão" },
  { dvr_id: "dvr-2", canal: 1, nome: "Garagem" },
];

const dados: DeteccoesPorTipo = {
  movimento: [
    { dvr_id: "dvr-1", canal: 1 },
    { dvr_id: "dvr-2", canal: 1 },
  ],
  portao: [{ dvr_id: "dvr-1", canal: 2 }],
};

describe("camerasDoTipoFiltro", () => {
  it("mostra todas as câmeras quando nenhum tipo foi escolhido", () => {
    expect(camerasDoTipoFiltro(cameras, null, indicesPorTipo(dados))).toHaveLength(3);
  });

  it("mostra só as câmeras com o tipo escolhido ligado", () => {
    const chaves = indicesPorTipo(dados);
    expect(camerasDoTipoFiltro(cameras, "portao", chaves).map((c) => c.nome)).toEqual(["Portão"]);
    expect(camerasDoTipoFiltro(cameras, "movimento", chaves).map((c) => c.nome)).toEqual([
      "Entrada",
      "Garagem",
    ]);
  });

  it("não mostra nenhuma câmera quando o tipo escolhido não tem nenhuma linha", () => {
    expect(camerasDoTipoFiltro(cameras, "movimento", indicesPorTipo({ portao: [] }))).toEqual([]);
  });

  it("não repete câmera ligada mais de uma vez no mesmo tipo", () => {
    const chaves = indicesPorTipo({
      movimento: [
        { dvr_id: "dvr-1", canal: 1 },
        { dvr_id: "dvr-1", canal: 1 },
      ],
    });
    expect(chaves.movimento?.size).toBe(1);
    expect(camerasDoTipoFiltro(cameras, "movimento", chaves).map((c) => c.nome)).toEqual([
      "Entrada",
    ]);
  });
});

describe("opcoesDeTipo", () => {
  it("traz 'todos os tipos' e a quantidade de câmeras ligadas de cada tipo", () => {
    expect(opcoesDeTipo(dados)).toEqual([
      { value: TODOS_OS_TIPOS, label: "Todos os tipos" },
      { value: "movimento", label: "Movimento (2)" },
      { value: "portao", label: "Portão aberto (1)" },
      { value: "portao_v2", label: "Portão aberto 2.0 (0)" },
    ]);
  });

  it("mostra zero enquanto a consulta ainda não respondeu", () => {
    expect(opcoesDeTipo(undefined)[1]?.label).toBe("Movimento (0)");
  });
});

describe("chaveCamera", () => {
  it("monta a mesma chave usada nas tabelas de detecção", () => {
    expect(chaveCamera("dvr-1", 3)).toBe("dvr-1:3");
  });
});
