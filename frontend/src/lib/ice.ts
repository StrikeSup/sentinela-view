import { supabase } from "@/integrations/supabase/client";

/**
 * Configuração ICE usada por TODAS as conexões de vídeo do navegador.
 *
 * Sem TURN, a imagem só atravessa quando os dois lados estão na mesma rede.
 * O servidor entrega a lista (e credenciais temporárias) em /api/video/ice;
 * se ela não estiver disponível, seguimos com STUN público, como antes.
 */

const PADRAO: RTCConfiguration = {
  bundlePolicy: "max-bundle",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const VALIDADE_MS = 10 * 60 * 1000;

let cache: { em: number; config: RTCConfiguration } | null = null;
let emAndamento: Promise<RTCConfiguration> | null = null;

async function buscar(): Promise<RTCConfiguration> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/video/ice", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return PADRAO;
    const json = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(json.iceServers) || json.iceServers.length === 0) return PADRAO;
    return { bundlePolicy: "max-bundle", iceServers: json.iceServers };
  } catch {
    return PADRAO;
  }
}

/** Lista de servidores ICE, com cache curto (as credenciais TURN expiram). */
export async function configIce(): Promise<RTCConfiguration> {
  const agora = Date.now();
  if (cache && agora - cache.em < VALIDADE_MS) return cache.config;
  if (!emAndamento) {
    emAndamento = buscar()
      .then((config) => {
        cache = { em: Date.now(), config };
        return config;
      })
      .finally(() => {
        emAndamento = null;
      });
  }
  return emAndamento;
}

/** Última configuração conhecida, para usos síncronos. */
export function configIceAtual(): RTCConfiguration {
  return cache?.config ?? PADRAO;
}

/**
 * Modo diagnóstico escolhido pelo operador: força o uso do retransmissor
 * (TURN). Ative no console com `localStorage.setItem("sentinela:ice-relay","1")`
 * ou pela URL `?ice=relay`. Fora dele, a rota direta continua preferida.
 */
export function modoRelayForcado(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("ice") === "relay") return true;
    return window.localStorage.getItem("sentinela:ice-relay") === "1";
  } catch {
    return false;
  }
}

/** Remove credenciais/consulta da URL TURN antes de exibir ou registrar. */
export function urlIceSegura(url: string | undefined | null): string {
  if (!url) return "?";
  return url.replace(/\?.*$/, "").replace(/\/\/[^@/]*@/, "//");
}
