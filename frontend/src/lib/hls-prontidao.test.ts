import { describe, it, expect, vi } from "vitest";
import { verificarPlaylist, urlInternaPlaylist, playlistUtil } from "./hls-prontidao";

const PATH = "sv_52d03eb0dbd377570d";
const resp = (status: number, body = "") => new Response(body, { status });
const VALIDA = "#EXTM3U\n#EXT-X-VERSION:9\n#EXTINF:1.0,\nseg0.mp4\n";

describe("verificarPlaylist", () => {
  it("200 com playlist válida = pronta", async () => {
    const f = vi.fn(async () => resp(200, VALIDA));
    expect(await verificarPlaylist(PATH, "tk", { fetchFn: f as never })).toEqual({
      pronta: true,
      status: 200,
    });
  });
  it("404 e 500 não ficam prontas e expõem status", async () => {
    for (const s of [404, 500]) {
      const r = await verificarPlaylist(PATH, "tk", { fetchFn: (async () => resp(s)) as never });
      expect(r).toEqual({ pronta: false, status: s, motivo: "http_erro" });
    }
  });
  it("200 sem segmento ou sem #EXTM3U não é pronta", async () => {
    const a = await verificarPlaylist(PATH, "t", {
      fetchFn: (async () => resp(200, "#EXTM3U\n#EXT-X-VERSION:9\n")) as never,
    });
    expect(a).toMatchObject({ pronta: false, motivo: "sem_midia" });
    const b = await verificarPlaylist(PATH, "t", {
      fetchFn: (async () => resp(200, "<html>")) as never,
    });
    expect(b).toMatchObject({ pronta: false, motivo: "sem_extm3u" });
  });
  it("timeout é limitado", async () => {
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, rej) =>
        init.signal!.addEventListener("abort", () => rej(new Error("abort"))),
      );
    const t0 = Date.now();
    const r = await verificarPlaylist(PATH, "t", { fetchFn: f as never, timeoutMs: 50 });
    expect(r).toMatchObject({ pronta: false, motivo: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("só usa host interno fixo e path gerado (anti-SSRF)", async () => {
    const f = vi.fn(async () => resp(200, VALIDA));
    expect(await verificarPlaylist("../evil", "t", { fetchFn: f as never })).toMatchObject({
      motivo: "path_invalido",
    });
    expect(f).not.toHaveBeenCalled();
    expect(urlInternaPlaylist("http://x", "t")).toBeNull();
    expect(urlInternaPlaylist(PATH, "a&b")).toBe(
      `http://mediamtx:8888/${PATH}/index.m3u8?token=a%26b`,
    );
  });
  it("token expirado (401 do media-auth) não é pronto", async () => {
    const r = await verificarPlaylist(PATH, "t", { fetchFn: (async () => resp(401)) as never });
    expect(r).toMatchObject({ pronta: false, status: 401 });
  });
  it("verificações concorrentes são independentes", async () => {
    let n = 0;
    const f = async () => (n++ % 2 ? resp(404) : resp(200, VALIDA));
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => verificarPlaylist(PATH, "t", { fetchFn: f as never })),
    );
    expect(rs.filter((r) => r.pronta)).toHaveLength(2);
  });
  it("LL-HLS com partes conta como mídia", () => {
    expect(playlistUtil('#EXTM3U\n#EXT-X-PART:DURATION=0.2,URI="p.mp4"\n')).toBe(true);
  });
});
