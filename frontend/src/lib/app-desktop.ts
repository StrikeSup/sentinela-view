/**
 * Modo direto do aplicativo Windows: vídeo sem conversão (H.264/H.265) por
 * HLS fMP4, decodificado pela placa de vídeo. Navegador comum segue no WebRTC.
 * Só chamar no navegador (useEffect/handlers).
 */
declare global {
  interface Window {
    sentinelaApp?: { desktop: true; versao: string; hevc: boolean };
  }
}

export function ehAppDesktop(): boolean {
  return typeof window !== "undefined" && window.sentinelaApp?.desktop === true;
}

export function suportaHevc(): boolean {
  if (typeof window === "undefined" || typeof MediaSource === "undefined") return false;
  return (
    MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"') ||
    MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L120.90"')
  );
}

/** Câmeras que falharam no modo direto voltam ao WebRTC por 10 min. */
const falhas = new Map<string, number>();
const PAUSA_FALHA_MS = 10 * 60 * 1000;

export function marcarFalhaDireto(chave: string) {
  falhas.set(chave, Date.now() + PAUSA_FALHA_MS);
}

export function usarModoDireto(chave: string, agora = Date.now()): boolean {
  if (!ehAppDesktop() || !suportaHevc()) return false;
  const ate = falhas.get(chave);
  return !ate || ate < agora;
}
