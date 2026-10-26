import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { FileText, Maximize2, Minus, Pause, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import type { RegistroPortao } from "@/lib/portao-log";

export function PortaoLogJanela({ registros, onFechar, onLimpar }: { registros: RegistroPortao[]; onFechar: () => void; onLimpar: () => void }) {
  const { isMaster } = useAuth();
  const [pausado, setPausado] = useState<RegistroPortao[] | null>(null);
  const [minimizado, setMinimizado] = useState(false);
  const [box, setBox] = useState({ x: 0, y: 0, width: 520, height: 420 });
  const [montado, setMontado] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const seguir = useRef(true);
  useEffect(() => {
    setBox({ x: Math.max(8, window.innerWidth - 544), y: Math.min(140, window.innerHeight / 4), width: Math.min(520, window.innerWidth - 16), height: Math.min(420, window.innerHeight - 160) });
    setMontado(true);
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);
  const visiveis = pausado ?? registros;
  useEffect(() => {
    const el = listaRef.current;
    if (el && seguir.current && !pausado) el.scrollTop = el.scrollHeight;
  }, [registros, pausado, minimizado]);
  if (!montado || !isMaster) return null;
  const pct = (n: number | undefined) => n === undefined ? "—" : `${n}%`;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50">
      <Rnd bounds="parent" position={{ x: box.x, y: box.y }} size={{ width: box.width, height: minimizado ? 48 : box.height }} minWidth={Math.min(300, window.innerWidth - 16)} minHeight={200} maxWidth="100%" maxHeight="100%" dragHandleClassName="portao-log-titulo" cancel="button" enableResizing={!minimizado} onDragStop={(_, data) => setBox((b) => ({ ...b, x: data.x, y: data.y }))} onResizeStop={(_, __, el, ___, position) => setBox({ ...position, width: el.offsetWidth, height: el.offsetHeight })} className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-border bg-background text-foreground shadow-xl" role="dialog" aria-modal="false" aria-label="Log de decisão do portão">
        <div className="portao-log-titulo flex h-12 shrink-0 cursor-move touch-none items-center gap-2 border-b border-border bg-muted px-3">
          <FileText className="h-4 w-4 shrink-0" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Log do portão</h2>
          <Button size="icon" variant="ghost" title={minimizado ? "Restaurar" : "Minimizar"} aria-label={minimizado ? "Restaurar log" : "Minimizar log"} onClick={() => setMinimizado((v) => !v)}>{minimizado ? <Maximize2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}</Button>
          <Button size="icon" variant="ghost" title="Fechar log" aria-label="Fechar log" onClick={onFechar}><X className="h-4 w-4" /></Button>
        </div>
        {!minimizado && <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="flex-1 text-xs text-muted-foreground">Navegador · {pausado ? "Pausado" : "Ao vivo"} · {visiveis.length}/120 leituras</span>
            <Button size="icon" variant="outline" title={pausado ? "Retomar log" : "Pausar log"} aria-label={pausado ? "Retomar log" : "Pausar log"} onClick={() => setPausado((p) => p ? null : [...registros])}>{pausado ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
            <Button size="icon" variant="outline" title="Limpar log" aria-label="Limpar log" onClick={() => { onLimpar(); if (pausado) setPausado([]); }}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div ref={listaRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-3" onScroll={(e) => { const el = e.currentTarget; seguir.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
            {!visiveis.length && <p className="text-sm text-muted-foreground">Aguardando imagem, contorno e fotos de aberto e fechado para iniciar as leituras.</p>}
            <p className="mb-3 text-xs text-muted-foreground">Prévia local, não é o diagnóstico do Agent. Dia e noite são comparados juntos no modo avançado.</p>
            <ol className="space-y-3">
              {visiveis.map((r) => <li key={r.id} className="border-b border-border pb-3 text-xs leading-relaxed">
                <div className="flex flex-wrap justify-between gap-1 font-semibold"><time>{new Date(r.hora).toLocaleTimeString("pt-BR")}</time><span className={r.leitura.estado === "aberto" ? "text-destructive" : "text-foreground"}>Leitura: {r.leitura.estado} · confirmado: {r.status}</span></div>
                <p className="mt-1">{r.motivo}</p><p>{r.confirmacao}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  <div><dt className="inline">Abertura: </dt><dd className="inline">{pct(r.barras?.abertura)}</dd></div>
                  <div><dt className="inline">Confiança: </dt><dd className="inline">{r.leitura.confianca}% (heurística)</dd></div>
                  <div><dt className="inline">Dif. fechado: </dt><dd className="inline">{pct(r.leitura.distFechado)}</dd></div>
                  <div><dt className="inline">Dif. aberto: </dt><dd className="inline">{pct(r.leitura.distAberto)}</dd></div>
                  <div><dt className="inline">Grades: </dt><dd className="inline">{pct(r.leitura.gradesPct)}</dd></div>
                  {r.barras?.ritmo ? <>
                    <div><dt className="inline">Nota (fechado): </dt><dd className="inline">{Math.round(r.barras.ritmo.score * 100)}%</dd></div>
                    <div><dt className="inline">Ritmo grades: </dt><dd className="inline">{Math.round(r.barras.ritmo.periodicidade * 100)}%</dd></div>
                    <div><dt className="inline">Bordas vert.: </dt><dd className="inline">{Math.round(r.barras.ritmo.densidade * 100)}%</dd></div>
                    <div><dt className="inline">Semelhança: </dt><dd className="inline">{Math.round(r.barras.ritmo.ssim * 100)}%</dd></div>
                  </> : <div><dt className="inline">Barras atual/ref.: </dt><dd className="inline">{r.barras ? `${r.barras.barrasAtual}/${r.barras.barrasFechado}` : "—"}</dd></div>}
                </dl>
                <p className="mt-1 text-muted-foreground">Sensibilidade {r.sensibilidade}% · {r.referencias}</p>
                <p className={r.alerta ? "text-destructive" : "text-muted-foreground"}>Aberto há {r.tempo}s · alerta após {r.tolerancia}s · {r.alerta ? "Alerta ativo" : "Sem alerta"}</p>
              </li>)}
            </ol>
          </div>
        </>}
      </Rnd>
    </div>, document.body,
  );
}