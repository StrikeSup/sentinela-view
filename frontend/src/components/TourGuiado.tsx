import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AjudaPasso } from "@/lib/ajuda";

type Retangulo = { top: number; left: number; width: number; height: number };

function textoNormalizado(valor: string) {
  return valor.trim().toLocaleLowerCase("pt-BR").replace(/[^a-z0-9áàâãéèêíïóôõöúç]/gi, "");
}

function refinarCampo(el: Element, titulo: string): Element {
  const controles = el.matches("input, textarea, select, button, [role=\"combobox\"]")
    ? [el]
    : Array.from(el.querySelectorAll("input, textarea, select, button, [role=\"combobox\"]"));
  if (controles.length <= 1) return el;

  const procurado = textoNormalizado(titulo);
  const labels = Array.from(el.querySelectorAll("label"));
  const label = labels.find((item) => textoNormalizado(item.textContent ?? "") === procurado);
  return label?.parentElement ?? el;
}

function medir(seletor: string | null, titulo: string): Retangulo | null {
  if (!seletor) return null;
  let el: Element | null = null;
  try {
    el = document.querySelector(seletor);
  } catch {
    el = null;
  }
  if (!el) return null;
  el = refinarCampo(el, titulo);
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourGuiado({
  passos,
  onFechar,
}: {
  passos: AjudaPasso[];
  onFechar: () => void;
}) {
  const [indice, setIndice] = useState(0);
  const [alvo, setAlvo] = useState<Retangulo | null>(null);
  const passo = passos[indice];
  const raiz = useRef<HTMLDivElement>(null);

  // Dentro de uma janela (subtela), impede que ela trate os cliques do passo a passo como "clique fora".
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const parar = (e: Event) => e.stopPropagation();
    const eventos = ["pointerdown", "mousedown", "touchstart", "focusin"];
    eventos.forEach((ev) => el.addEventListener(ev, parar));
    return () => eventos.forEach((ev) => el.removeEventListener(ev, parar));
  });

  useEffect(() => {
    if (!passo) return;
    let el: Element | null = null;
    try {
      el = passo.seletor ? document.querySelector(passo.seletor) : null;
    } catch {
      el = null;
    }
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const atualizar = () => setAlvo(medir(passo.seletor, passo.titulo));
    atualizar();
    const t = setInterval(atualizar, 250);
    window.addEventListener("resize", atualizar);
    window.addEventListener("scroll", atualizar, true);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", atualizar);
      window.removeEventListener("scroll", atualizar, true);
    };
  }, [passo]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      if (e.key === "ArrowRight" || e.key === "Enter")
        setIndice((i) => (i + 1 < passos.length ? i + 1 : i));
      if (e.key === "ArrowLeft") setIndice((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [passos.length, onFechar]);

  if (!passo) return null;

  const margem = 8;
  const buraco = alvo
    ? {
        top: alvo.top - margem,
        left: alvo.left - margem,
        width: alvo.width + margem * 2,
        height: alvo.height + margem * 2,
      }
    : null;

  const larguraCard = 360;
  let cardTop = window.innerHeight / 2 - 120;
  let cardLeft = window.innerWidth / 2 - larguraCard / 2;
  let seta: "cima" | "baixo" | null = null;
  if (buraco) {
    const abaixo = buraco.top + buraco.height + 16;
    const cabeAbaixo = abaixo + 220 < window.innerHeight;
    cardTop = cabeAbaixo ? abaixo : Math.max(16, buraco.top - 236);
    seta = cabeAbaixo ? "cima" : "baixo";
    cardLeft = Math.min(
      Math.max(16, buraco.left + buraco.width / 2 - larguraCard / 2),
      window.innerWidth - larguraCard - 16,
    );
  }

  const progresso = ((indice + 1) / passos.length) * 100;

  return createPortal(
    <div
      ref={raiz}
      className="fixed inset-0 z-[9998]"
      style={{ pointerEvents: "auto" }}
    >
      {buraco ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all"
          style={{
            top: buraco.top,
            left: buraco.left,
            width: buraco.width,
            height: buraco.height,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.72)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/70" />
      )}

      <div
        className="fixed w-[360px] rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        style={{ top: cardTop, left: cardLeft }}
      >
        {seta && (
          <div
            className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border bg-popover"
            style={
              seta === "cima"
                ? { top: -7, borderRight: "none", borderBottom: "none" }
                : { bottom: -7, borderLeft: "none", borderTop: "none" }
            }
          />
        )}
        <button
          aria-label="Fechar ajuda"
          onClick={onFechar}
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="pr-6 font-display text-lg font-semibold">{passo.titulo}</h3>
        {passo.texto && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{passo.texto}</p>
        )}
        {passo.imagem_url && (
          <img
            src={passo.imagem_url}
            alt={passo.titulo}
            className="mt-3 max-h-56 w-full rounded-md border object-contain"
          />
        )}
        <div className="mt-4 h-1 w-full rounded bg-muted">
          <div className="h-1 rounded bg-primary transition-all" style={{ width: `${progresso}%` }} />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {indice > 0 && (
            <Button variant="outline" size="sm" onClick={() => setIndice(indice - 1)}>
              Voltar
            </Button>
          )}
          {indice + 1 < passos.length ? (
            <Button size="sm" onClick={() => setIndice(indice + 1)}>
              Próximo (Passo {indice + 1} de {passos.length})
            </Button>
          ) : (
            <Button size="sm" onClick={onFechar}>
              Concluir
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
