/**
 * Player WebRTC da API pública — mesmo fluxo do Diagnóstico WebRTC.
 * Arquivo independente (só APIs do navegador) para servir também de exemplo
 * às empresas parceiras.
 *
 * Etapa 1 "rápido": só host/STUN (sem TURN), coleta ICE curta.
 * Etapa 2 (fallback): STUN+TURN, quando a etapa 1 falha ou fica 20 s sem quadro.
 * Uma sessão por vez: a anterior é encerrada antes da próxima.
 */
export type EventoPlayer = { rotulo: string; detalhe?: string; ok?: boolean };

export type OpcoesPlayer = {
  base: string; // ex.: https://seu-dominio/api/public/v1
  token: string; // token do POST /login
  dvrId: string;
  canal: number;
  video: HTMLVideoElement;
  qualidade?: "extra" | "principal";
  prazoAnswerMs?: number; // padrão 30 s por etapa
  semQuadroMs?: number; // padrão 20 s
  aoEvento?: (e: EventoPlayer) => void;
};

type Sessao = { id: string };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function contarCandidatos(sdp?: string | null) {
  return (sdp ?? "").split(/\r?\n/).filter((l) => l.startsWith("a=candidate:")).length;
}

async function coletaRapida(pc: RTCPeerConnection): Promise<boolean> {
  const t0 = performance.now();
  for (;;) {
    const n = contarCandidatos(pc.localDescription?.sdp);
    if (pc.iceGatheringState === "complete") return n > 0;
    const dt = performance.now() - t0;
    if (dt >= 1800 && n > 0) return true;
    if (dt >= 5000) return false;
    await dormir(100);
  }
}

async function coletaCompleta(pc: RTCPeerConnection, limiteMs = 6000) {
  const t0 = performance.now();
  while (pc.iceGatheringState !== "complete" && performance.now() - t0 < limiteMs)
    await dormir(100);
}

export function abrirPlayerWebrtc(o: OpcoesPlayer) {
  const cab = { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" };
  const ev = (rotulo: string, detalhe?: string, ok = true) =>
    o.aoEvento?.({ rotulo, ok, ...(detalhe ? { detalhe } : {}) });
  const cliente = `api-player:${crypto.randomUUID()}`;
  let parado = false;
  let pc: RTCPeerConnection | null = null;
  let sessao: Sessao | null = null;
  let renovar: ReturnType<typeof setInterval> | null = null;

  const encerrarSessao = async () => {
    if (renovar) clearInterval(renovar);
    renovar = null;
    const s = sessao;
    sessao = null;
    if (s)
      await fetch(`${o.base}/webrtc/${s.id}`, { method: "DELETE", headers: cab }).catch(
        () => undefined,
      );
  };
  const fecharPc = () => {
    try {
      pc?.getReceivers().forEach((r) => r.track?.stop());
      pc?.close();
    } catch {
      /* ignora */
    }
    pc = null;
    o.video.srcObject = null;
  };

  /** Uma tentativa completa. Devolve true quando o primeiro quadro aparece. */
  async function tentar(rapido: boolean, ice: RTCIceServer[]): Promise<boolean> {
    const servidores = rapido
      ? ice
          .map((s) => ({ urls: [s.urls].flat().filter((u) => /^stun:/i.test(String(u))) }))
          .filter((s) => s.urls.length > 0)
      : ice;
    const atual = new RTCPeerConnection({ iceServers: servidores });
    pc = atual;
    let falhou = false;
    atual.oniceconnectionstatechange = () => {
      if (["connected", "completed"].includes(atual.iceConnectionState)) ev("ICE conectado");
      if (atual.iceConnectionState === "failed") falhou = true;
    };
    atual.onconnectionstatechange = () => {
      if (atual.connectionState === "failed") falhou = true;
    };
    const stream = new MediaStream();
    atual.ontrack = (e) => {
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      o.video.muted = true;
      o.video.playsInline = true;
      if (o.video.srcObject !== stream) o.video.srcObject = stream;
      if (e.track.kind === "video" || o.video.paused) void o.video.play().catch(() => undefined);
    };
    atual.addTransceiver("video", { direction: "recvonly" });
    atual.addTransceiver("audio", { direction: "recvonly" });

    const offer = await atual.createOffer();
    await atual.setLocalDescription(offer);
    if (rapido) {
      if (!(await coletaRapida(atual))) {
        ev("Sem candidatos ICE locais", undefined, false);
        return false;
      }
    } else await coletaCompleta(atual);
    if (parado) return false;
    const sdp = atual.localDescription?.sdp ?? offer.sdp ?? "";
    ev(
      `Oferta criada (${rapido ? "rápido, sem TURN" : "com TURN"})`,
      `${contarCandidatos(sdp)} candidato(s)`,
    );

    const r = await fetch(`${o.base}/webrtc`, {
      method: "POST",
      headers: cab,
      body: JSON.stringify({
        dvr_id: o.dvrId,
        canal: o.canal,
        offer_sdp: sdp,
        qualidade: o.qualidade ?? "extra",
        cliente_sessao: cliente,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || !j["session_id"]) {
      ev(`Pedido recusado (HTTP ${r.status})`, String(j["erro"] ?? j["motivo"] ?? ""), false);
      return false;
    }
    sessao = { id: String(j["session_id"]) };
    const sid = sessao.id;
    ev("Pedido aceito pela API", r.headers.get("Server-Timing") ?? undefined);
    let confirmado = false;
    renovar = setInterval(() => {
      void fetch(`${o.base}/webrtc/${sid}`, {
        method: "POST",
        headers: cab,
        body: JSON.stringify(confirmado ? { estado: "publicando" } : {}),
      }).catch(() => undefined);
    }, 20_000);

    // Consulta curta até o answer do Agent.
    const limite = Date.now() + (o.prazoAnswerMs ?? 30_000);
    let answer: string | null = null;
    while (!parado && !answer && Date.now() < limite) {
      const g = await fetch(`${o.base}/webrtc/${sid}`, { headers: cab }).catch(() => null);
      if (!g) {
        await dormir(500);
        continue;
      }
      const s = (await g.json().catch(() => ({}))) as Record<string, unknown>;
      if (g.status === 403 || g.status === 404) {
        ev(`Sessão indisponível (HTTP ${g.status})`, undefined, false);
        return false;
      }
      if (s["answer_sdp"]) answer = String(s["answer_sdp"]);
      else if (s["estado"] === "erro" || s["estado"] === "encerrada") {
        ev("Agent recusou", String(s["diagnostico"] ?? ""), false);
        return false;
      } else await dormir(Math.min(500, Math.max(150, Number(s["retry_after_ms"] ?? 250))));
    }
    if (!answer) {
      if (!parado) ev("Agent não respondeu no prazo", undefined, false);
      return false;
    }
    ev("Answer recebido do Agent");
    await atual.setRemoteDescription({ type: "answer", sdp: answer });

    // Primeiro quadro ou desistência (falha ICE / sem quadro no prazo).
    const quadro = await new Promise<boolean>((ok) => {
      const fimEm = Date.now() + (o.semQuadroMs ?? 20_000);
      const v = o.video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      let feito = false;
      const sucesso = () => {
        if (!feito) {
          feito = true;
          ok(true);
        }
      };
      if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(sucesso);
      else v.addEventListener("playing", sucesso, { once: true });
      const vigia = setInterval(() => {
        if (feito) return clearInterval(vigia);
        if (parado || falhou || Date.now() > fimEm) {
          clearInterval(vigia);
          feito = true;
          ok(false);
        }
      }, 200);
    });
    if (!quadro) {
      ev(falhou ? "Conexão falhou" : "Sem quadro em 20 s", undefined, false);
      return false;
    }
    confirmado = true;
    ev("Primeiro quadro no player");
    void fetch(`${o.base}/webrtc/${sid}`, {
      method: "POST",
      headers: cab,
      body: JSON.stringify({ estado: "publicando" }),
    }).catch(() => undefined);
    return true;
  }

  const pronto = (async () => {
    const r = await fetch(`${o.base}/ice`, { headers: cab });
    if (!r.ok) {
      ev(`Servidores ICE negados (HTTP ${r.status})`, undefined, false);
      return false;
    }
    const { iceServers, turn } = (await r.json()) as { iceServers: RTCIceServer[]; turn: boolean };
    if (await tentar(true, iceServers)) return true;
    if (parado) return false;
    await encerrarSessao();
    fecharPc();
    if (!turn) {
      ev("Sem TURN configurado para a segunda etapa", undefined, false);
      return false;
    }
    ev("Tentando com TURN (fora da rede)");
    return tentar(false, iceServers);
  })().catch((e: unknown) => {
    ev("Erro no player", e instanceof Error ? e.message : String(e), false);
    return false;
  });

  return {
    pronto,
    parar: async () => {
      parado = true;
      fecharPc();
      await encerrarSessao();
    },
  };
}
