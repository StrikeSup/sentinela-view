import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ancorar, autocorrNoPasso, energiaV2, medir } from "./ritmo";
import { CONFIRMACAO_INICIAL_V2, alertaV2, confirmarV2, decidirV2, type ConfirmacaoV2, type EstadoV2 } from "./fusao";
import { normalizarReferenciaV2, planoDeUso, retanguloRecorte } from "./referencias";

const L = 192, A = 64;
type Op = { fimGrades?: number; ruido?: number; seed?: number; passo?: number; ganho?: number; soma?: number; bordas?: boolean };
function cena({ fimGrades = L, ruido = 0, seed = 1, passo = 6, ganho = 1, soma = 0, bordas = false }: Op = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * ruido;
  const v = new Float32Array(L * A);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    let p = 150;
    if (x >= 150 && x < 154) p = 40; // poste
    if (x >= 90 && x < 130 && y > 30) p = 220; // carro
    if (x < fimGrades && x % passo < 2) p = 30;
    // Picos só nas extremidades (objetos com ritmo nas bordas).
    if (bordas && (x < 24 || x >= L - 24) && x % 6 < 2) p = 30;
    v[y * L + x] = (p + rnd()) * ganho + soma;
  }
  return v;
}

const ancora = ancorar([cena(), cena({ ruido: 10, seed: 3 })], L, A)!;
const ler = (v: Float32Array, ant: EstadoV2 = "incerto") => decidirV2(medir(v, ancora, L, A), 50, ant);
const seq = (estados: EstadoV2[], ini: ConfirmacaoV2 = CONFIRMACAO_INICIAL_V2, t0 = 0) =>
  estados.reduce((s, e, i) => confirmarV2(s, e, t0 + i * 1000), ini);
const fechadoHa = (ms: number): ConfirmacaoV2 => ({ ...CONFIRMACAO_INICIAL_V2, confirmado: "fechado", desdeMs: -ms });

describe("portão 2.0 — leitura visual", () => {
  it("ancora o passo de 6 colunas", () => expect(Math.round(ancora.pitch)).toBe(6));
  it("fechado com chuva é fechado", () => expect(ler(cena({ ruido: 35, seed: 7 })).estado).toBe("fechado"));
  it("aberto com poste e carro é aberto", () => expect(ler(cena({ fimGrades: 0 })).estado).toBe("aberto"));
  it("recolhido (15% das grades) é aberto", () => expect(ler(cena({ fimGrades: 30 })).estado).toBe("aberto"));
  it("explica o motivo", () => expect(ler(cena()).motivo).toMatch(/ritmo/));
  it("sem grades na foto fechado não ancora", () => expect(ancorar([new Float32Array(L * A).fill(120)], L, A)).toBeNull());

  it("5. aberto com picos só nas extremidades não vira fechado", () => {
    const s = medir(cena({ fimGrades: 0, bordas: true }), ancora, L, A);
    expect(s.continuidade!).toBeLessThan(0.5);
    expect(ler(cena({ fimGrades: 0, bordas: true })).estado).toBe("aberto");
  });
  it("6. barras com espaçamento diferente da referência não viram fechado", () => {
    const s = medir(cena({ passo: 11 }), ancora, L, A);
    expect(s.espacamento!).toBeLessThan(0.5);
    expect(ler(cena({ passo: 11 })).estado).not.toBe("fechado");
  });
  it("7. variações de iluminação (mais escuro e mais claro) mantêm fechado", () => {
    expect(ler(cena({ ganho: 0.55, ruido: 8 })).estado).toBe("fechado");
    expect(ler(cena({ ganho: 0.8, soma: 50 })).estado).toBe("fechado");
  });
  it("7b. imagem quase sem contraste (noite sem IR) fica Incerto por qualidade", () => {
    const d = ler(cena({ ganho: 0.05 }));
    expect(d.estado).toBe("incerto");
    expect(d.faixa).toBe("qualidade");
  });
  it("Hanning reduz energia falsa de rampa/borda (luz, carro) na banda das barras", () => {
    const n = 26;
    const rampa = Array.from({ length: n }, (_, i) => i * 0.3);
    const degrau = Array.from({ length: n }, (_, i) => (i < 9 ? 0 : 1));
    const barras = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * i) / 6.4));
    expect(energiaV2(rampa, 6.4, 0, n, true)).toBeLessThan(energiaV2(rampa, 6.4, 0, n, false) / 10);
    expect(energiaV2(degrau, 6.4, 0, n, true)).toBeLessThan(energiaV2(degrau, 6.4, 0, n, false));
    expect(energiaV2(barras, 6.4, 0, n, true)).toBeGreaterThan(0.8); // barras reais continuam fortes
  });
  it("autocorrelação reconhece o passo", () => {
    const p = Array.from({ length: 96 }, (_, i) => (i % 6 < 2 ? -1 : 0.5));
    expect(autocorrNoPasso(p, 6)).toBeGreaterThan(0.9);
  });
});

describe("portão 2.0 — confirmação temporal", () => {
  it("1. Fechado → Aberto confirma mesmo com o portão parado (sem movimento)", () => {
    const s = seq(["aberto", "aberto"], fechadoHa(60_000));
    expect(s.confirmado).toBe("aberto");
  });
  it("2. Aberto → Fechado", () => {
    const aberto: ConfirmacaoV2 = { ...CONFIRMACAO_INICIAL_V2, confirmado: "aberto", desdeMs: -60_000 };
    expect(seq(["fechado", "fechado"], aberto).confirmado).toBe("fechado");
  });
  it("3. Incerto intercalado não zera a transição legítima", () => {
    // Com Incerto no meio exige 3 leituras válidas (F1).
    expect(seq(["aberto", "incerto", "aberto", "aberto"], fechadoHa(60_000)).confirmado).toBe("aberto");
    expect(seq(["aberto", "incerto", "incerto", "aberto", "aberto"], fechadoHa(60_000)).confirmado).toBe("aberto");
  });
  it("3b. Incertos além da janela de evidência (8 s) descartam a transição", () => {
    expect(seq(["aberto", ...Array<EstadoV2>(8).fill("incerto"), "aberto"], fechadoHa(60_000)).confirmado).toBe("fechado");
  });
  it("3c. imagem perdida por muito tempo volta para Incerto", () => {
    expect(seq(Array<EstadoV2>(10).fill("incerto"), fechadoHa(60_000)).confirmado).toBe("incerto");
  });
  it("4. alternância rápida não troca de estado", () => {
    expect(seq(["aberto", "fechado", "aberto", "fechado"], fechadoHa(60_000)).confirmado).toBe("fechado");
    // Recém-confirmado: troca oposta só após a permanência mínima (3 s).
    const recem = confirmarV2(confirmarV2(fechadoHa(0), "aberto", 0), "aberto", 1000);
    expect(recem.confirmado).toBe("fechado");
    expect(confirmarV2(recem, "aberto", 3000).confirmado).toBe("aberto");
  });
  it("faixa intermediária não conta para nenhuma transição", () => {
    const d = decidirV2({ periodicidade: 0.5, densidade: 0.5, ssim: 0.5, pitch: 6 }, 50, "incerto");
    expect(d.faixa).toBe("intermediaria");
    expect(d.estado).toBe("incerto");
  });
  it("alerta depende só do estado confirmado e da tolerância", () => {
    const s: ConfirmacaoV2 = { ...CONFIRMACAO_INICIAL_V2, confirmado: "aberto", desdeMs: 0 };
    expect(alertaV2(s, 19_000, 20).alerta).toBe(false);
    expect(alertaV2(s, 20_000, 20)).toEqual({ tempoAbertoSegundos: 20, alerta: true });
    expect(alertaV2({ ...s, confirmado: "fechado" }, 99_000, 20).alerta).toBe(false);
  });
  it("10. o 2.0 não usa a trava de movimento nem a temporização do 1.0", () => {
    for (const f of ["src/lib/portao-v2/fusao.ts", "src/lib/portao-v2/ritmo.ts", "src/components/DeteccaoPortaoV2.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/travarPorMovimento|avancarTempo|decidirSsim|decidirRitmo/);
    }
    expect(confirmarV2.length).toBeLessThanOrEqual(4); // assinatura sem parâmetro de movimento
  });
});

describe("portão 2.0 — referências", () => {
  const png = "data:image/jpeg;base64,AAAA";
  it("8. evento (quadro completo) é recortado pela ROI cadastrada", () => {
    const ref = normalizarReferenciaV2({ src: png, origem: "evento", recortada: false })!;
    const plano = planoDeUso(ref, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
    expect(plano).toEqual({ recortar: true, roi: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } });
    expect(retanguloRecorte(640, 480, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 })).toEqual({ sx: 160, sy: 240, sw: 320, sh: 120 });
  });
  it("8b. legado e capturas recortadas são usados sem novo recorte (preservados)", () => {
    expect(normalizarReferenciaV2(png)).toEqual({ src: png, origem: "legado", recortada: null });
    expect(planoDeUso(normalizarReferenciaV2(png)!, null)).toEqual({ recortar: false });
  });
  it("9. referências e dimensões inválidas são recusadas", () => {
    expect(normalizarReferenciaV2("texto qualquer")).toBeNull();
    expect(normalizarReferenciaV2({ src: png, origem: "outro", recortada: true })).toBeNull();
    expect(retanguloRecorte(0, 480, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(retanguloRecorte(640.5, 480, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(retanguloRecorte(640, 480, { x: 0.8, y: 0, w: 0.5, h: 1 })).toBeNull();
    expect(retanguloRecorte(640, 480, { x: 0, y: 0, w: 0.005, h: 1 })).toBeNull();
    expect(planoDeUso({ src: png, origem: "evento", recortada: false }, { x: Number.NaN, y: 0, w: 1, h: 1 })).toBeNull();
  });
});

describe("portão 2.0 — E1: evidência através de Incertos", () => {
  const A: EstadoV2 = "aberto", F: EstadoV2 = "fechado", I: EstadoV2 = "incerto";
  const aberto = (ms: number): ConfirmacaoV2 => ({ ...CONFIRMACAO_INICIAL_V2, confirmado: "aberto", desdeMs: -ms });
  /** Segundo em que o confirmado chega a `alvo` (ou null). */
  const quando = (estados: EstadoV2[], ini: ConfirmacaoV2, alvo: EstadoV2) => {
    let s = ini;
    for (let i = 0; i < estados.length; i++) { s = confirmarV2(s, estados[i]!, i * 1000); if (s.confirmado === alvo) return i; }
    return null;
  };
  it("abertura: A A, A I A, A I I I A, A I I I I A", () => {
    expect(quando([A, A], fechadoHa(60_000), "aberto")).toBe(1);
    // F1: com Incerto no meio, A I A não basta; a 3ª leitura válida confirma.
    expect(quando([A, I, A], fechadoHa(60_000), "aberto")).toBeNull();
    expect(quando([A, I, A, A], fechadoHa(60_000), "aberto")).toBe(3);
    expect(quando([A, I, I, I, A, I, A], fechadoHa(60_000), "aberto")).toBe(6);
    expect(quando([A, I, I, I, I, A, A], fechadoHa(60_000), "aberto")).toBe(6);
  });
  it("A I I I I repetido não fica preso (antes: preso em Fechado)", () => {
    expect(quando([A, I, I, I, I, A, I, I, I, I, A], fechadoHa(60_000), "aberto")).toBe(10);
  });
  it("fechamento com interrupções por Incerto", () => {
    expect(quando([F, I, I, I, I, I, F], aberto(60_000), "fechado")).toBeNull();
    expect(quando([F, I, I, I, I, I, F, F], aberto(60_000), "fechado")).toBe(7);
  });
  it("Incerto nunca conta como leitura válida", () => {
    expect(seq([A, I, I, I, I, I, I], fechadoHa(60_000)).confirmado).toBe("fechado");
  });
  it("Incertos prolongados levam a Incerto (10 s), também a partir de Aberto", () => {
    expect(quando(Array<EstadoV2>(12).fill(I), fechadoHa(60_000), "incerto")).toBe(9);
    expect(quando(Array<EstadoV2>(12).fill(I), aberto(60_000), "incerto")).toBe(9);
    expect(seq(Array<EstadoV2>(9).fill(I), aberto(60_000)).confirmado).toBe("aberto");
  });
  it("recupera quando a qualidade volta", () => {
    const perdido = seq(Array<EstadoV2>(10).fill(I), fechadoHa(60_000));
    expect(perdido.confirmado).toBe("incerto");
    expect(seq([F, F], perdido, 10_000).confirmado).toBe("fechado");
  });
  it("alternância A F A F não troca; leitura do estado atual zera a evidência", () => {
    expect(seq([A, F, A, F, A, F], fechadoHa(60_000)).confirmado).toBe("fechado");
    expect(seq([A, I, F, I, A], fechadoHa(60_000)).confirmado).toBe("fechado");
  });
  it("permanência mínima de 3 s continua valendo", () => {
    const recem = { ...CONFIRMACAO_INICIAL_V2, confirmado: "aberto" as EstadoV2, desdeMs: 0 };
    expect(seq([F, F], recem, 0).confirmado).toBe("aberto");
    expect(seq([F, F, I, F], recem, 0).confirmado).toBe("fechado"); // aos 3 s
  });
  it("leituras válidas sempre confirmam em tempo limitado (não fica preso)", () => {
    // Pior caso permitido: uma leitura válida a cada 8 s.
    const s = [A, ...Array<EstadoV2>(7).fill(I), A, ...Array<EstadoV2>(7).fill(I), A];
    expect(quando(s, fechadoHa(60_000), "aberto")).toBe(16);
  });
});

describe("portão 2.0 — F1: 2 leituras seguidas ou 3 com Incerto", () => {
  const A: EstadoV2 = "aberto", F: EstadoV2 = "fechado", I: EstadoV2 = "incerto";
  const ab = { ...CONFIRMACAO_INICIAL_V2, confirmado: "aberto" as EstadoV2, desdeMs: -60_000 };
  const em = (e: EstadoV2[], ini: ConfirmacaoV2, alvo: EstadoV2) => { let s = ini; for (let i = 0; i < e.length; i++) { s = confirmarV2(s, e[i]!, i * 1000); if (s.confirmado === alvo) return i; } return null; };
  it("sem Incerto: 2 seguidas bastam (abrir e fechar)", () => {
    expect(em([A, A], fechadoHa(60_000), "aberto")).toBe(1);
    expect(em([F, F], ab, "fechado")).toBe(1);
  });
  it("leituras válidas isoladas com Incertos a cada 8 s não confirmam com só 2", () => {
    expect(em([A, ...Array<EstadoV2>(7).fill(I), A], fechadoHa(60_000), "aberto")).toBeNull();
  });
  it("leitura do estado atual cancela; oposta reinicia", () => {
    expect(em([A, I, A, F, A], fechadoHa(60_000), "aberto")).toBeNull();
    expect(em([A, I, F, F], ab, "fechado")).toBe(3); // F reinicia sem herdar o Incerto
  });
  it("imagem ruim no meio do fechamento e recuperação", () => {
    expect(em([F, I, I, F, F], ab, "fechado")).toBe(4);
    const perdido = seq(Array<EstadoV2>(10).fill(I), ab);
    expect(perdido.confirmado).toBe("incerto");
    expect(seq([A, A], perdido, 10_000).confirmado).toBe("aberto");
  });
});
