import { describe, it, expect } from "vitest";
import { aguardarQuadroApresentado, type VideoQuadro } from "./quadro-apresentado";

function videoFalso(comRvfc = false) {
  const alvo = new EventTarget();
  let rvfcCb: (() => void) | null = null;
  const v = {
    currentTime: 0,
    videoWidth: 0,
    addEventListener: alvo.addEventListener.bind(alvo),
    removeEventListener: alvo.removeEventListener.bind(alvo),
    ...(comRvfc
      ? {
          requestVideoFrameCallback: (cb: () => void) => ((rvfcCb = cb), 1),
          cancelVideoFrameCallback: () => (rvfcCb = null),
        }
      : {}),
  };
  return {
    v: v as unknown as VideoQuadro & { currentTime: number; videoWidth: number },
    tick: () => alvo.dispatchEvent(new Event("timeupdate")),
    quadro: () => rvfcCb?.(),
  };
}

describe("aguardarQuadroApresentado", () => {
  it("fallback: não dispara só por tocar; dispara ao avançar tempo com largura", () => {
    const f = videoFalso();
    let n = 0;
    aguardarQuadroApresentado(f.v, () => n++);
    f.tick();
    expect(n).toBe(0);
    f.v.currentTime = 0.5;
    f.tick();
    expect(n).toBe(0); // videoWidth ainda 0
    f.v.videoWidth = 640;
    f.tick();
    f.v.currentTime = 1;
    f.tick();
    expect(n).toBe(1);
  });

  it("fallback: cleanup impede disparo de player desmontado", () => {
    const f = videoFalso();
    let n = 0;
    const limpar = aguardarQuadroApresentado(f.v, () => n++);
    limpar();
    f.v.videoWidth = 640;
    f.v.currentTime = 2;
    f.tick();
    expect(n).toBe(0);
  });

  it("rvfc é o caminho principal e respeita cleanup", () => {
    const f = videoFalso(true);
    let n = 0;
    aguardarQuadroApresentado(f.v, () => n++);
    f.v.videoWidth = 640;
    f.v.currentTime = 3;
    f.tick(); // timeupdate ignorado quando há rvfc
    expect(n).toBe(0);
    f.quadro();
    expect(n).toBe(1);
    const g = videoFalso(true);
    let m = 0;
    const limpar = aguardarQuadroApresentado(g.v, () => m++);
    limpar();
    g.v.videoWidth = 640;
    g.quadro();
    expect(m).toBe(0);
  });
});
