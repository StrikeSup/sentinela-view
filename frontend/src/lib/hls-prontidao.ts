// Verificação limitada (bounded) de que o MediaMTX da VPS já serve a playlist HLS.
// Puro e testável: sem imports de servidor. Nunca registre a URL (contém token).

/** Host interno fixo do MediaMTX na rede do docker compose (evita SSRF). */
export const HLS_INTERNO = "http://mediamtx:8888";
const PATH_VALIDO = /^sv_[0-9a-f]{18}$/;

export type ResultadoPlaylist =
  | { pronta: true; status: 200 }
  | {
      pronta: false;
      status: number | null;
      motivo: "path_invalido" | "http_erro" | "sem_extm3u" | "sem_midia" | "timeout" | "rede";
    };

export function urlInternaPlaylist(path: string, token: string): string | null {
  if (!PATH_VALIDO.test(path)) return null;
  return `${HLS_INTERNO}/${path}/index.m3u8?token=${encodeURIComponent(token)}`;
}

/** Playlist útil: #EXTM3U e ao menos um segmento/parte ou variante. */
export function playlistUtil(texto: string): boolean {
  if (!texto.trimStart().startsWith("#EXTM3U")) return false;
  return /#EXTINF|#EXT-X-PART:|#EXT-X-STREAM-INF/.test(texto);
}

export async function verificarPlaylist(
  path: string,
  token: string,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<ResultadoPlaylist> {
  const url = urlInternaPlaylist(path, token);
  if (!url) return { pronta: false, status: null, motivo: "path_invalido" };
  const f = opts.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500);
  try {
    const res = await f(url, { signal: ctrl.signal, redirect: "manual" });
    if (res.status !== 200) return { pronta: false, status: res.status, motivo: "http_erro" };
    const texto = (await res.text()).slice(0, 65536);
    if (!texto.trimStart().startsWith("#EXTM3U"))
      return { pronta: false, status: 200, motivo: "sem_extm3u" };
    if (!playlistUtil(texto)) return { pronta: false, status: 200, motivo: "sem_midia" };
    return { pronta: true, status: 200 };
  } catch {
    return { pronta: false, status: null, motivo: ctrl.signal.aborted ? "timeout" : "rede" };
  } finally {
    clearTimeout(t);
  }
}

export function diagnosticoPlaylist(r: ResultadoPlaylist): string {
  if (r.pronta) return "playlist HLS disponível";
  switch (r.motivo) {
    case "http_erro":
      return `retransmissor respondeu HTTP ${r.status} para a playlist`;
    case "sem_extm3u":
      return "resposta do retransmissor não é uma playlist HLS";
    case "sem_midia":
      return "playlist ainda sem segmentos";
    case "timeout":
      return "retransmissor não respondeu a tempo";
    case "path_invalido":
      return "caminho de vídeo inválido";
    default:
      return "falha de rede ao consultar o retransmissor";
  }
}
