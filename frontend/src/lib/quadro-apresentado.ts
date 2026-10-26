/** Subconjunto do HTMLVideoElement usado para detectar quadro apresentado. */
export type VideoQuadro = Pick<
  HTMLVideoElement,
  "currentTime" | "videoWidth" | "addEventListener" | "removeEventListener"
> & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
  getVideoPlaybackQuality?: () => { totalVideoFrames: number };
};

/**
 * Chama `cb` uma única vez quando há prova de quadro apresentado:
 * requestVideoFrameCallback (principal) ou, sem ele, avanço de currentTime
 * via timeupdate com videoWidth > 0 (ou quadros contados pelo navegador).
 * Retorna cleanup que impede disparo após desmontar/trocar.
 */
export function aguardarQuadroApresentado(video: VideoQuadro, cb: () => void): () => void {
  let ativo = true;
  const disparar = () => {
    if (!ativo) return;
    ativo = false;
    cb();
  };
  if (typeof video.requestVideoFrameCallback === "function") {
    const id = video.requestVideoFrameCallback(() => {
      if (video.videoWidth > 0) disparar();
    });
    return () => {
      ativo = false;
      video.cancelVideoFrameCallback?.(id);
    };
  }
  const inicio = video.currentTime;
  const quadrosInicio = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
  const aoAvancar = () => {
    if (!ativo || video.videoWidth <= 0) return;
    const quadros = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    if (video.currentTime > inicio || quadros > quadrosInicio) {
      video.removeEventListener("timeupdate", aoAvancar);
      disparar();
    }
  };
  video.addEventListener("timeupdate", aoAvancar);
  return () => {
    ativo = false;
    video.removeEventListener("timeupdate", aoAvancar);
  };
}
