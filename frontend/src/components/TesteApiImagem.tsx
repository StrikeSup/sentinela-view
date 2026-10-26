import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Play, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboSelect } from "@/components/ComboSelect";
import { abrirPlayerWebrtc } from "@/lib/api-webrtc-player";

type Evento = { rotulo: string; ms: number; detalhe?: string | undefined; ok: boolean };
type Dvr = { id: string; nome: string; canais: number };

/** Mede o tempo real da API de imagem: chamada(s) + abertura do HLS até o 1º quadro. */
export function TesteApiImagem() {
  const [dvrs, setDvrs] = useState<Dvr[]>([]);
  const [dvrId, setDvrId] = useState("");
  const [canal, setCanal] = useState(1);
  const [modo, setModo] = useState<"normal" | "nao" | "webrtc" | "rtsp">("webrtc");
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [resposta, setResposta] = useState("");
  const [linkRtsp, setLinkRtsp] = useState("");
  const [rodando, setRodando] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cancelado = useRef(false);
  const webrtcRef = useRef<{ parar: () => Promise<void> } | null>(null);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/public/v1/dvrs", {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (r.ok) setDvrs(((await r.json()) as { dvrs: Dvr[] }).dvrs ?? []);
    })();
    return () => parar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parar() {
    cancelado.current = true;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    void webrtcRef.current?.parar();
    webrtcRef.current = null;
    setRodando(false);
  }

  async function iniciar() {
    parar();
    cancelado.current = false;
    setRodando(true);
    setEventos([]);
    setResposta("");
    setLinkRtsp("");
    const t0 = performance.now();
    const add = (rotulo: string, ok = true, detalhe?: string) =>
      setEventos((e) => [...e, { rotulo, ms: Math.round(performance.now() - t0), ok, detalhe }]);
    const tk = await token();
    if (modo === "rtsp") {
      add("Pedido enviado à API");
      try {
        const r = await fetch(`/api/public/v1/rtsp?dvr_id=${dvrId}&canal=${canal}&minutos=60`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
        const j = (await r.json()) as Record<string, unknown>;
        setResposta(JSON.stringify(j, null, 2));
        const link = typeof j["rtsp"] === "string" ? j["rtsp"] : "";
        setLinkRtsp(link);
        add(
          `Resposta da API: HTTP ${r.status} ${String(j["estado"] ?? j["erro"] ?? "")}`,
          r.status < 300,
          String(j["observacao"] ?? j["erro"] ?? ""),
        );
        if (link) add("Link RTSP pronto para o VLC");
      } catch (e) {
        add("Falha ao pedir o link", false, String(e));
      }
      setRodando(false);
      return;
    }
    if (modo === "webrtc") {
      const player = abrirPlayerWebrtc({
        base: `${window.location.origin}/api/public/v1`,
        token: tk,
        dvrId,
        canal,
        video: videoRef.current!,
        aoEvento: (e) => add(e.rotulo, e.ok ?? true, e.detalhe),
      });
      webrtcRef.current = player;
      void player.pronto.then((ok) => {
        if (!ok) setRodando(false);
      });
      return;
    }
    const url = `/api/public/v1/imagem?dvr_id=${dvrId}&canal=${canal}${modo === "nao" ? "&aguardar=nao" : ""}`;
    let urlVideo: string | null = null;
    for (let n = 1; n <= 40 && !cancelado.current; n++) {
      const ti = performance.now();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
      const j = (await r.json()) as Record<string, unknown>;
      setResposta(JSON.stringify(j, null, 2));
      const dur = Math.round(performance.now() - ti);
      add(
        `Chamada ${n}: HTTP ${r.status} ${String(j["estado"] ?? j["erro"] ?? "")}`,
        r.status < 300,
        `${dur} ms · ${String(j["etapa"] ?? "")} ${j["diagnostico"] ? "· " + String(j["diagnostico"]) : ""}`,
      );
      if (r.status === 200) {
        urlVideo = j["url_video"] as string;
        break;
      }
      if (r.status !== 202) break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    if (!urlVideo || cancelado.current) return setRodando(false);

    const video = videoRef.current!;
    const primeiroQuadro = () => add("Primeiro quadro no player");
    if (typeof video.requestVideoFrameCallback === "function")
      video.requestVideoFrameCallback(primeiroQuadro);
    else (video as HTMLVideoElement).addEventListener("playing", primeiroQuadro, { once: true });
    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => add("Playlist HLS carregada"));
      hls.once(Hls.Events.FRAG_LOADED, () => add("Primeiro pedaço de vídeo baixado"));
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) add("Erro no player", false, d.details);
      });
      hls.loadSource(urlVideo);
      hls.attachMedia(video);
    } else {
      video.src = urlVideo;
    }
    void video.play().catch(() => undefined);
  }

  const dvr = dvrs.find((d) => d.id === dvrId);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Testar tempo da API de imagem</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-[2fr_100px_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label>DVR</Label>
            <ComboSelect
              value={dvrId}
              onChange={setDvrId}
              options={dvrs.map((d) => ({ value: d.id, label: d.nome }))}
              placeholder="Escolha o DVR"
            />
          </div>
          <div className="space-y-1">
            <Label>Câmera</Label>
            <Input
              type="number"
              min={1}
              max={dvr?.canais ?? 512}
              value={canal}
              onChange={(e) => setCanal(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1">
            <Label>Modo</Label>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={modo === "webrtc" ? "default" : "outline"}
                onClick={() => setModo("webrtc")}
              >
                WebRTC
              </Button>
              <Button
                size="sm"
                variant={modo === "normal" ? "default" : "outline"}
                onClick={() => setModo("normal")}
              >
                Normal
              </Button>
              <Button
                size="sm"
                variant={modo === "nao" ? "default" : "outline"}
                onClick={() => setModo("nao")}
              >
                aguardar=nao
              </Button>
              <Button
                size="sm"
                variant={modo === "rtsp" ? "default" : "outline"}
                onClick={() => setModo("rtsp")}
              >
                RTSP (VLC)
              </Button>
            </div>
          </div>
          {rodando ? (
            <Button variant="outline" onClick={parar}>
              <Square className="mr-1 h-4 w-4" /> Parar
            </Button>
          ) : (
            <Button disabled={!dvrId} onClick={() => void iniciar()}>
              <Play className="mr-1 h-4 w-4" /> Testar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          WebRTC usa o mesmo fluxo do Diagnóstico (rede local primeiro, TURN se falhar ou ficar 20 s
          sem imagem). Normal e aguardar=nao usam o link HLS da VPS. RTSP (VLC) mede o tempo até o
          link ficar pronto; o navegador não toca RTSP, então copie o link e abra no VLC.
        </p>
        {linkRtsp && (
          <div className="flex items-center gap-2 rounded border p-2">
            <code className="flex-1 break-all text-xs">{linkRtsp}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(linkRtsp)}
            >
              Copiar
            </Button>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="font-medium">Linha do tempo (desde o clique)</p>
            {eventos.length === 0 && <p className="text-muted-foreground">Nenhum teste ainda.</p>}
            <ul className="space-y-1">
              {eventos.map((e, i) => (
                <li key={i} className="rounded border p-2">
                  <div className="flex justify-between gap-2">
                    <span className={e.ok ? "" : "text-destructive"}>
                      {e.ok ? "✓" : "✗"} {e.rotulo}
                    </span>
                    <span className="font-mono">{(e.ms / 1000).toFixed(2)} s</span>
                  </div>
                  {e.detalhe && <p className="text-xs text-muted-foreground">{e.detalhe}</p>}
                </li>
              ))}
            </ul>
            {resposta && (
              <pre className="max-h-48 overflow-auto rounded border bg-muted p-2 text-xs">
                {resposta}
              </pre>
            )}
          </div>
          <video
            ref={videoRef}
            muted
            playsInline
            controls
            className="aspect-video w-full rounded bg-muted object-contain"
          />
        </div>
      </CardContent>
    </Card>
  );
}
