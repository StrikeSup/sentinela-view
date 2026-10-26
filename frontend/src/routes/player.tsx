import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { abrirPlayerWebrtc } from "@/lib/api-webrtc-player";

/**
 * Player público em uma única URL: /player?dvr_id=X&canal=N#token=TOKEN
 * Faz sozinho GET /ice → POST /webrtc → consulta do answer → TURN se precisar.
 * O token vai no "#" para não ser enviado ao servidor nem aparecer em logs.
 * Avisa a página que o incorpora via postMessage ({ sentinela: "primeiro_quadro" | "erro" }).
 */
export const Route = createFileRoute("/player")({
  head: () => ({
    meta: [
      { title: "Player ao vivo — Sentinela VIEW" },
      { name: "description", content: "Vídeo ao vivo da câmera pelo Sentinela VIEW." },
      { property: "og:title", content: "Player ao vivo — Sentinela VIEW" },
      { property: "og:description", content: "Vídeo ao vivo da câmera pelo Sentinela VIEW." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlayerPublico,
});

function avisar(msg: Record<string, unknown>) {
  if (window.parent !== window) window.parent.postMessage({ sentinela: true, ...msg }, "*");
}

function PlayerPublico() {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Conectando…");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = h.get("token") ?? q.get("token") ?? "";
    const dvrId = q.get("dvr_id") ?? "";
    const canal = Number(q.get("canal"));
    if (!token || !dvrId || !Number.isInteger(canal) || canal < 1) {
      setStatus("Informe dvr_id, canal e #token=TOKEN no endereço.");
      avisar({ evento: "erro", motivo: "parametros" });
      return;
    }
    const inicio = performance.now();
    const player = abrirPlayerWebrtc({
      base: `${window.location.origin}/api/public/v1`,
      token,
      dvrId,
      canal,
      qualidade: q.get("qualidade") === "principal" ? "principal" : "extra",
      video: video.current!,
      aoEvento: (e) => {
        if (e.ok === false) setStatus(e.detalhe ? `${e.rotulo}: ${e.detalhe}` : e.rotulo);
        if (/primeiro quadro/i.test(e.rotulo)) {
          setStatus("");
          avisar({ evento: "primeiro_quadro", ms: Math.round(performance.now() - inicio) });
        }
      },
    });
    void player.pronto.then((ok) => {
      if (!ok) avisar({ evento: "erro", motivo: "sem_video" });
    });
    return () => {
      void player.parar();
    };
  }, []);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-background">
      <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
      {status && (
        <p className="absolute bottom-3 left-3 rounded bg-card/80 px-3 py-1 text-sm text-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
