import { supabase } from "@/integrations/supabase/client";
import { configIce } from "@/lib/ice";

/**
 * Espelho de vídeo entre navegadores.
 *
 * Quando um usuário já está recebendo a imagem de uma câmera, o navegador dele
 * pode repassar esse mesmo vídeo para quem acabou de abrir a mesma câmera.
 * O novo espectador vê a imagem quase instantaneamente e, assim que a conexão
 * própria dele com o servidor local entrega mídia, o espelho é desligado.
 *
 * A sinalização usa o canal Realtime do Supabase (broadcast); o vídeo em si
 * vai direto entre os dois navegadores (P2P/LAN).
 */

// A lista de servidores ICE (inclusive TURN, que permite atravessar redes
// diferentes) vem do servidor em /api/video/ice.

/** Quantos espectadores um mesmo navegador aceita repassar por câmera. */
const MAX_ESPECTADORES = 3;

type Canal = ReturnType<typeof supabase.channel>;

type Payload = {
  tipo: "pedido" | "oferta" | "resposta" | "ice" | "fim";
  id: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  de?: "fonte" | "espectador";
};

type Grupo = {
  canal: Canal;
  usos: number;
  ouvintes: Set<(p: Payload) => void>;
  /** o canal já terminou de entrar (antes disso o envio cairia no REST) */
  pronto: boolean;
  /** sinais guardados enquanto o canal ainda estava entrando */
  fila: Payload[];
};

const grupos = new Map<string, Grupo>();

function nomeCanal(chave: string) {
  return `espelho:${chave}`;
}

function usarCanal(chave: string, ouvinte: (p: Payload) => void) {
  let grupo = grupos.get(chave);
  if (!grupo) {
    const canal = supabase.channel(nomeCanal(chave), {
      config: { broadcast: { self: false } },
    });
    const novo: Grupo = { canal, usos: 0, ouvintes: new Set(), pronto: false, fila: [] };
    canal.on("broadcast", { event: "sinal" }, ({ payload }) => {
      for (const fn of novo.ouvintes) fn(payload as Payload);
    });
    canal.subscribe((estado) => {
      novo.pronto = estado === "SUBSCRIBED";
      if (!novo.pronto) return;
      const pendentes = novo.fila.splice(0, novo.fila.length);
      for (const p of pendentes) {
        void novo.canal.send({ type: "broadcast", event: "sinal", payload: p });
      }
    });
    grupos.set(chave, novo);
    grupo = novo;
  }
  grupo.usos += 1;
  grupo.ouvintes.add(ouvinte);
  const atual = grupo;
  return {
    // enviar antes de o canal entrar faria o Supabase cair no envio por REST
    // (mais lento e com aviso no console): nesse caso o sinal espera na fila
    enviar: (payload: Payload) => {
      if (!atual.pronto) {
        atual.fila.push(payload);
        if (atual.fila.length > 30) atual.fila.shift();
        return;
      }
      void atual.canal.send({ type: "broadcast", event: "sinal", payload });
    },
    soltar: () => {
      atual.ouvintes.delete(ouvinte);
      atual.usos -= 1;
      if (atual.usos > 0) return;
      grupos.delete(chave);
      void supabase.removeChannel(atual.canal);
    },
  };
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ------------------------- Lado fonte (quem já vê) ------------------------ */

type Fonte = {
  stream: MediaStream;
  soltar: () => void;
  enviar: (p: Payload) => void;
  conexoes: Map<string, RTCPeerConnection>;
};

const fontes = new Map<string, Fonte>();

/** Publica o vídeo já recebido desta câmera para outros usuários do sistema. */
export function registrarFonte(chave: string, stream: MediaStream) {
  const existente = fontes.get(chave);
  if (existente) {
    existente.stream = stream;
    return;
  }
  const fonte: Fonte = {
    stream,
    conexoes: new Map(),
    soltar: () => undefined,
    enviar: () => undefined,
  };
  fontes.set(chave, fonte);

  const { enviar, soltar } = usarCanal(chave, (p) => {
    void atenderPedido(chave, fonte, p);
  });
  fonte.enviar = enviar;
  fonte.soltar = soltar;
}

/** Deixa de repassar esta câmera (a imagem própria acabou). */
/** Indica se outro usuário está recebendo esta câmera por espelho agora. */
export function fonteEmUso(chave: string): boolean {
  const fonte = fontes.get(chave);
  if (!fonte) return false;
  for (const pc of fonte.conexoes.values()) {
    if (pc.connectionState === "connected" || pc.connectionState === "connecting") return true;
  }
  return false;
}

export function removerFonte(chave: string) {
  const fonte = fontes.get(chave);
  if (!fonte) return;
  fontes.delete(chave);
  for (const pc of fonte.conexoes.values()) {
    try {
      pc.close();
    } catch {
      // já estava fechada
    }
  }
  fonte.conexoes.clear();
  fonte.soltar();
}

async function atenderPedido(chave: string, fonte: Fonte, p: Payload) {
  if (p.tipo === "fim") {
    const pc = fonte.conexoes.get(p.id);
    if (pc) {
      try {
        pc.close();
      } catch {
        // já estava fechada
      }
      fonte.conexoes.delete(p.id);
    }
    return;
  }
  if (p.tipo === "resposta" && p.sdp) {
    const pc = fonte.conexoes.get(p.id);
    if (!pc || pc.signalingState !== "have-local-offer") return;
    await pc.setRemoteDescription({ type: "answer", sdp: p.sdp }).catch(() => undefined);
    return;
  }
  if (p.tipo === "ice" && p.de === "espectador" && p.candidate) {
    await fonte.conexoes.get(p.id)?.addIceCandidate(p.candidate).catch(() => undefined);
    return;
  }
  if (p.tipo !== "pedido") return;
  // A aba pode estar em segundo plano (outro layout/janela aberta): o repasse
  // continua valendo, pois apenas encaminha o vídeo que já está chegando.
  if (fonte.conexoes.size >= MAX_ESPECTADORES) return;
  const faixas = fonte.stream.getVideoTracks().filter((t) => t.readyState === "live");
  if (faixas.length === 0) return;

  const pc = new RTCPeerConnection(await configIce());
  fonte.conexoes.set(p.id, pc);
  for (const faixa of faixas) pc.addTrack(faixa, fonte.stream);
  pc.onicecandidate = (e) => {
    if (e.candidate) fonte.enviar({ tipo: "ice", id: p.id, de: "fonte", candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      fonte.conexoes.delete(p.id);
      try {
        pc.close();
      } catch {
        // já estava fechada
      }
    }
  };
  const oferta = await pc.createOffer();
  await pc.setLocalDescription(oferta);
  fonte.enviar({ tipo: "oferta", id: p.id, sdp: pc.localDescription?.sdp ?? oferta.sdp ?? "" });
}

/* --------------------- Lado espectador (quem acabou de abrir) -------------- */

/**
 * Pede a outro navegador o vídeo desta câmera. Retorna uma função para
 * encerrar o espelho assim que a conexão própria entregar imagem.
 */
export function pedirEspelho(
  chave: string,
  aoReceber: (stream: MediaStream) => void,
): () => void {
  if (typeof RTCPeerConnection === "undefined") return () => undefined;
  // Este navegador já é a fonte desta câmera: não faz sentido pedir espelho.
  if (fontes.has(chave)) return () => undefined;

  const id = uuid();
  let pc: RTCPeerConnection | null = null;
  let encerrado = false;

  const { enviar, soltar } = usarCanal(chave, (p) => {
    if (encerrado || p.id !== id) return;
    void (async () => {
      if (p.tipo === "oferta" && p.sdp && !pc) {
        pc = new RTCPeerConnection(await configIce());
        pc.onicecandidate = (e) => {
          if (e.candidate)
            enviar({ tipo: "ice", id, de: "espectador", candidate: e.candidate.toJSON() });
        };
        pc.ontrack = (e) => {
          if (encerrado) return;
          aoReceber(e.streams[0] ?? new MediaStream([e.track]));
        };
        await pc.setRemoteDescription({ type: "offer", sdp: p.sdp });
        const resposta = await pc.createAnswer();
        await pc.setLocalDescription(resposta);
        enviar({ tipo: "resposta", id, sdp: pc.localDescription?.sdp ?? resposta.sdp ?? "" });
        return;
      }
      if (p.tipo === "ice" && p.de === "fonte" && p.candidate && pc) {
        await pc.addIceCandidate(p.candidate).catch(() => undefined);
      }
    })();
  });

  enviar({ tipo: "pedido", id });

  return () => {
    if (encerrado) return;
    encerrado = true;
    enviar({ tipo: "fim", id });
    try {
      pc?.close();
    } catch {
      // já estava fechada
    }
    pc = null;
    soltar();
  };
}
