import { describe, expect, it } from "vitest";

import { LIMITE_LEITURA_MS, seloPortao, textoIdade } from "./portao-status";

const AGORA = Date.parse("2026-10-09T15:00:00Z");
const em = (msAtras: number) => new Date(AGORA - msAtras).toISOString();

describe("seloPortao", () => {
  it("sem leitura quando o Agent nunca informou estado", () => {
    expect(seloPortao(null, null, AGORA)).toBe("sem_leitura");
    expect(seloPortao(undefined, em(0), AGORA)).toBe("sem_leitura");
  });

  it("sem leitura quando não há horário da leitura", () => {
    expect(seloPortao("aberto", null, AGORA)).toBe("sem_leitura");
    expect(seloPortao("aberto", "não é data", AGORA)).toBe("sem_leitura");
  });

  it("leitura recente devolve o estado confirmado", () => {
    expect(seloPortao("fechado", em(3_000), AGORA)).toBe("fechado");
    expect(seloPortao("aberto", em(60_000), AGORA)).toBe("aberto");
  });

  it(`leitura com mais de ${LIMITE_LEITURA_MS / 1000} s vira sem leitura`, () => {
    expect(seloPortao("aberto", em(LIMITE_LEITURA_MS + 1), AGORA)).toBe("sem_leitura");
    expect(seloPortao("aberto", em(LIMITE_LEITURA_MS - 1_000), AGORA)).toBe("aberto");
  });

  it("leitura no futuro além da tolerância vira sem leitura", () => {
    expect(seloPortao("aberto", new Date(AGORA + 5 * 60_000).toISOString(), AGORA)).toBe("sem_leitura");
    expect(seloPortao("aberto", new Date(AGORA + 10_000).toISOString(), AGORA)).toBe("aberto");
  });
});

describe("textoIdade", () => {
  it("formata a idade em português", () => {
    expect(textoIdade(0)).toBe("agora");
    expect(textoIdade(4_999)).toBe("agora");
    expect(textoIdade(5_000)).toBe("há 5 s");
    expect(textoIdade(59_000)).toBe("há 59 s");
    expect(textoIdade(2 * 60_000)).toBe("há 2 min");
    expect(textoIdade(60 * 60_000)).toBe("há 1 h");
    expect(textoIdade(3 * 24 * 60 * 60_000)).toBe("há 3 d");
  });

  it("não devolve idade negativa", () => {
    expect(textoIdade(-5_000)).toBe("agora");
  });
});
