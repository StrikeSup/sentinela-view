import { describe, it, expect, beforeEach } from "vitest";
import { RotacaoDeteccao, chaveCamera, type Relogio } from "./rotacao-deteccao";

class RelogioFalso implements Relogio {
  agora = 0;
  private seq = 0;
  private tarefas = new Map<number, { em: number; fn: () => void }>();
  agendar = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.tarefas.set(id, { em: this.agora + ms, fn });
    return id;
  };
  cancelar = (id: unknown) => void this.tarefas.delete(id as number);
  pendentes() {
    return this.tarefas.size;
  }
  avancar(ms: number) {
    const fim = this.agora + ms;
    for (;;) {
      const prox = [...this.tarefas.entries()]
        .filter(([, t]) => t.em <= fim)
        .sort((a, b) => a[1].em - b[1].em)[0];
      if (!prox) break;
      this.tarefas.delete(prox[0]);
      this.agora = prox[1].em;
      prox[1].fn();
    }
    this.agora = fim;
  }
}

const a1 = chaveCamera("dvr-a", 1);
const b1 = chaveCamera("dvr-b", 1);
const b2 = chaveCamera("dvr-b", 2);
const b3 = chaveCamera("dvr-b", 3);

const CAMS: Record<string, string[]> = {
  A: [a1],
  B: [b1, b2, b3],
  C: [chaveCamera("dvr-c", 1)],
  // mesmas chaves repetidas em slots diferentes
  D: [b1, b1, chaveCamera("DVR-B", 1), b2],
};

let relogio: RelogioFalso;
let abertos: string[];
const criar = (retencaoMs = 0) =>
  new RotacaoDeteccao({
    retencaoMs,
    camerasDe: (id) => CAMS[id] ?? [],
    abrir: (id) => abertos.push(id),
    relogio,
  });

beforeEach(() => {
  relogio = new RelogioFalso();
  abertos = [];
});

describe("RotacaoDeteccao", () => {
  it("retenção conta desde a abertura, sem esperar as imagens", () => {
    const r = criar(0);
    r.evento("B");
    r.evento("C");
    expect(abertos).toEqual(["B"]);
    // Nenhum quadro chegou: mesmo assim troca ao fim do mínimo (15 s).
    relogio.avancar(14999);
    expect(abertos).toEqual(["B"]);
    relogio.avancar(1);
    expect(abertos).toEqual(["B", "C"]);
  });

  it("quadros que chegam não estendem nem encurtam a retenção", () => {
    const r = criar(40000);
    r.evento("B");
    r.evento("C");
    relogio.avancar(20000);
    [b1, b2, b3].forEach((k) => r.primeiroQuadro(k));
    expect(r.estado()).toMatchObject({ fase: "retendo", falha: false, faltantes: [] });
    relogio.avancar(19999);
    expect(abertos).toEqual(["B"]);
    relogio.avancar(1);
    expect(abertos).toEqual(["B", "C"]);
  });

  it("uma câmera nunca carrega: sinaliza faltante em 30 s, sem bloquear a troca", () => {
    const r = criar(40000);
    r.evento("B");
    r.evento("C");
    r.primeiroQuadro(b1);
    r.primeiroQuadro(b2);
    relogio.avancar(29999);
    expect(r.estado()).toMatchObject({ fase: "aguardando-quadro", falha: false });
    relogio.avancar(1);
    expect(r.estado()).toMatchObject({ fase: "retendo", falha: true, faltantes: [b3] });
    relogio.avancar(9999);
    expect(abertos).toEqual(["B"]);
    relogio.avancar(1);
    expect(abertos).toEqual(["B", "C"]);
  });

  it("retenção menor que o prazo de imagem: troca antes de sinalizar falha", () => {
    const r = criar(0);
    r.evento("B");
    r.evento("C");
    relogio.avancar(15000);
    expect(abertos).toEqual(["B", "C"]);
    // O prazo do layout B foi cancelado na troca; a falha agora é do layout C.
    relogio.avancar(29999);
    expect(r.estado()).toMatchObject({ atual: "C", falha: false });
    relogio.avancar(1);
    expect(r.estado()).toMatchObject({ atual: "C", falha: true });
  });

  it("nenhum quadro e sem pendência: estaciona, sem loop", () => {
    const r = criar(0);
    r.evento("A");
    r.evento("C");
    relogio.avancar(45000);
    expect(abertos).toEqual(["A", "C"]);
    relogio.avancar(600000);
    expect(abertos).toEqual(["A", "C"]);
    expect(r.estado()).toMatchObject({ atual: "C", fase: "livre", falha: true });
    expect(relogio.pendentes()).toBe(0);
  });

  it("eventos em rajada: abre um, mantém só UMA troca pendente (mais recente)", () => {
    const r = criar();
    r.evento("A");
    for (let i = 0; i < 20; i++) {
      r.evento("A");
      r.evento("B");
      r.evento("C");
    }
    expect(abertos).toEqual(["A"]);
    expect(r.estado().pendente).toBe("C");
    expect(r.evento("C")).toBe("ignorado-pendente");
    relogio.avancar(15000);
    expect(abertos).toEqual(["A", "C"]);
    expect(r.estado().pendente).toBeNull();
  });

  it("mesmas IDs repetidas no layout contam uma vez; quadro repetido não duplica", () => {
    const r = criar();
    r.evento("D");
    expect(r.estado().total).toBe(2);
    r.primeiroQuadro(b1);
    r.primeiroQuadro(b1);
    expect(r.estado().faltantes).toEqual([b2]);
    r.primeiroQuadro(b2);
    expect(r.estado().fase).toBe("retendo");
  });

  it("câmera repetida entre layouts com player remontado exige quadro novo", () => {
    const r = criar(40000);
    r.evento("D");
    r.primeiroQuadro(b1);
    r.primeiroQuadro(b2);
    r.evento("B");
    relogio.avancar(40000);
    expect(abertos).toEqual(["D", "B"]);
    expect(r.estado()).toMatchObject({ fase: "aguardando-quadro", faltantes: [b1, b2, b3] });
    r.evento("C");
    // quadros do layout anterior não contam; só os novos após a remontagem
    r.primeiroQuadro(b1);
    r.primeiroQuadro(b2);
    expect(r.estado().faltantes).toEqual([b3]);
    relogio.avancar(30000);
    expect(r.estado()).toMatchObject({ fase: "retendo", falha: true, faltantes: [b3] });
    relogio.avancar(10000);
    expect(abertos).toEqual(["D", "B", "C"]);
  });

  it("quadro de câmera de outro layout não conta", () => {
    const r = criar();
    r.evento("A");
    r.primeiroQuadro(b1);
    expect(r.estado()).toMatchObject({ fase: "aguardando-quadro", faltantes: [a1] });
  });

  it("primeiro layout (definirAtual): retenção conta da abertura, sem reabrir", () => {
    const r = criar(0);
    r.definirAtual("B");
    expect(abertos).toEqual([]); // não reabre
    expect(r.estado().fase).toBe("aguardando-quadro");
    expect(r.evento("C")).toBe("pendente");
    relogio.avancar(14999);
    expect(abertos).toEqual([]);
    relogio.avancar(1);
    expect(abertos).toEqual(["C"]);
  });

  it("primeiro layout sem quadros: troca na retenção e sinaliza falha em 30 s", () => {
    const r = criar(40000);
    r.definirAtual("B");
    r.evento("C");
    relogio.avancar(30000);
    expect(abertos).toEqual([]);
    expect(r.estado()).toMatchObject({ falha: true, faltantes: [b1, b2, b3] });
    relogio.avancar(9999);
    expect(abertos).toEqual([]);
    relogio.avancar(1);
    expect(abertos).toEqual(["C"]);
  });

  it("layout idêntico: eventos do layout na tela não reabrem nem remontam", () => {
    const r = criar();
    r.definirAtual("A");
    expect(r.evento("A")).toBe("ignorado-na-tela");
    expect(r.evento("B")).toBe("pendente");
    expect(r.evento("B")).toBe("ignorado-pendente");
    relogio.avancar(15000);
    expect(abertos).toEqual(["B"]);
    expect(r.evento("B")).toBe("ignorado-na-tela");
    expect(abertos).toEqual(["B"]);
  });

  it("cleanup: encerrar cancela timers e ignora novos eventos/quadros", () => {
    const r = criar();
    r.evento("A");
    r.evento("B");
    r.encerrar();
    expect(relogio.pendentes()).toBe(0);
    r.primeiroQuadro(a1);
    relogio.avancar(600000);
    r.evento("C");
    expect(abertos).toEqual(["A"]);
  });
});
