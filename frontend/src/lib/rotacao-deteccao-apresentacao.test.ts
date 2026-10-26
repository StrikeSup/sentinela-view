import { describe, expect, it } from "vitest";
import { apresentarRotacaoDeteccao } from "./rotacao-deteccao-apresentacao";
import type { EstadoRotacao } from "./rotacao-deteccao";

const opcoes = {
  nomeLayout: (id: string) => ({ A: "Entrada", B: "Garagem" })[id] ?? id,
  nomeCamera: (chave: string) =>
    ({ "dvr-a:1": "Portaria CH1", "dvr-b:3": "Garagem DVR CH3" })[chave] ?? chave,
};

const estado = (parcial: Partial<EstadoRotacao>): EstadoRotacao => ({
  fase: "aguardando-quadro",
  atual: "A",
  pendente: null,
  falha: false,
  faltantes: ["dvr-b:3"],
  total: 2,
  ...parcial,
});

describe("apresentarRotacaoDeteccao", () => {
  it("mostra o progresso e a próxima troca sem expor dados de conexão", () => {
    expect(apresentarRotacaoDeteccao(estado({ pendente: "B" }), opcoes)).toEqual({
      tipo: "progresso",
      titulo: "Entrada: 1/2 câmeras com imagem",
      detalhe: "Próximo: Garagem",
    });
  });

  it("após o prazo lista DVR/canal e diz que mantém o layout sem pendência", () => {
    expect(
      apresentarRotacaoDeteccao(
        estado({ fase: "livre", falha: true, faltantes: ["dvr-a:1", "dvr-b:3"] }),
        opcoes,
      ),
    ).toEqual({
      tipo: "falha",
      titulo: "Entrada: 2/2 câmeras sem imagem",
      detalhe: "Portaria CH1, Garagem DVR CH3 — mantendo layout",
    });
  });

  it("não mostra indicador fora da preparação quando não há falha", () => {
    expect(apresentarRotacaoDeteccao(estado({ fase: "retendo", faltantes: [] }), opcoes)).toBeNull();
  });
});