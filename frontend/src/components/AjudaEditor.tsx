import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  type AjudaPasso,
  type AjudaTela,
  criarPasso,
  enviarImagem,
  excluirPasso,
  listarPassos,
  salvarPasso,
  salvarTela,
  seletorDoElemento,
} from "@/lib/ajuda";

/** Modo de escolher um elemento da tela clicando nele. */
function Selecionador({ onEscolher, onCancelar }: { onEscolher: (s: string) => void; onCancelar: () => void }) {
  const [caixa, setCaixa] = useState<DOMRect | null>(null);

  useEffect(() => {
    const encontrarAlvo = (x: number, y: number) => {
      const seletores = '[data-ajuda], input, textarea, select, button, [role="combobox"]';
      const candidatos = Array.from(document.querySelectorAll<HTMLElement>(seletores)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });

      // elementFromPoint ignora controles desativados com pointer-events: none.
      // A busca pelas coordenadas permite escolher também esses botões.
      return candidatos.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      })[0] ?? document.elementFromPoint(x, y);
    };
    const mover = (e: MouseEvent) => {
      const el = encontrarAlvo(e.clientX, e.clientY);
      setCaixa(el ? el.getBoundingClientRect() : null);
    };
    const escolher = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = encontrarAlvo(e.clientX, e.clientY);
      if (el) onEscolher(seletorDoElemento(el));
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar();
    };
    window.addEventListener("mousemove", mover, true);
    window.addEventListener("pointerdown", escolher, true);
    window.addEventListener("keydown", tecla, true);
    return () => {
      window.removeEventListener("mousemove", mover, true);
      window.removeEventListener("pointerdown", escolher, true);
      window.removeEventListener("keydown", tecla, true);
    };
  }, [onEscolher, onCancelar]);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[10000] cursor-crosshair">
      {caixa && (
        <div
          className="fixed rounded bg-primary/20 ring-2 ring-primary"
          style={{ top: caixa.top, left: caixa.left, width: caixa.width, height: caixa.height }}
        />
      )}
      <div className="fixed left-1/2 top-4 -translate-x-1/2 rounded-full bg-popover px-4 py-2 text-sm shadow-lg">
        Clique no item que deve ser destacado — Esc para cancelar
      </div>
    </div>,
    document.body,
  );
}

export function AjudaEditor({
  tela,
  aberto,
  onFechar,
  onSalvo,
}: {
  tela: AjudaTela;
  aberto: boolean;
  onFechar: () => void;
  onSalvo?: () => void;
}) {
  const [passos, setPassos] = useState<AjudaPasso[]>([]);
  const [resumo, setResumo] = useState(tela.resumo ?? "");
  const [titulo, setTitulo] = useState(tela.titulo);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [foco, setFoco] = useState<string | null>(null);
  const [selecionando, setSelecionando] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const focoRef = useRef<string | null>(null);
  focoRef.current = foco;

  useEffect(() => {
    if (!aberto) return;
    setCarregando(true);
    void listarPassos(tela.id)
      .then(setPassos)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setCarregando(false));
    setResumo(tela.resumo ?? "");
    setTitulo(tela.titulo);
  }, [aberto, tela]);

  const aplicarImagem = async (blob: Blob, passoId: string) => {
    try {
      const url = await enviarImagem(blob, tela.rota.replace(/\//g, "") || "tela");
      setPassos((ps) => ps.map((p) => (p.id === passoId ? { ...p, imagem_url: url } : p)));
      toast.success("Print adicionado ao passo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o print.");
    }
  };

  // Ctrl+V cola o print direto no passo em foco.
  useEffect(() => {
    if (!aberto) return;
    const colar = (e: ClipboardEvent) => {
      const alvo = focoRef.current;
      if (!alvo) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      void aplicarImagem(blob, alvo);
    };
    window.addEventListener("paste", colar);
    return () => window.removeEventListener("paste", colar);
  }, [aberto, tela]);

  const salvarTudo = async () => {
    setSalvando(true);
    try {
      await salvarTela({ id: tela.id, titulo, resumo, categoria: tela.categoria });
      for (let i = 0; i < passos.length; i++) {
        const p = passos[i]!;
        await salvarPasso({ ...p, ordem: i + 1 });
      }
      toast.success("Ajuda salva.");
      onSalvo?.();
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const adicionar = async () => {
    try {
      const novo = await criarPasso(tela.id, passos.length + 1);
      setPassos((ps) => [...ps, novo]);
      setFoco(novo.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o passo.");
    }
  };

  const remover = async (id: string) => {
    try {
      await excluirPasso(id);
      setPassos((ps) => ps.filter((p) => p.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  };

  const mover = (indice: number, direcao: -1 | 1) => {
    setPassos((ps) => {
      const novo = [...ps];
      const destino = indice + direcao;
      if (destino < 0 || destino >= novo.length) return ps;
      const a = novo[indice]!;
      novo[indice] = novo[destino]!;
      novo[destino] = a;
      return novo;
    });
  };

  const atualizar = (id: string, campo: keyof AjudaPasso, valor: string | null) =>
    setPassos((ps) => ps.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));

  return (
    <>
      {selecionando && (
        <Selecionador
          onEscolher={(s) => {
            atualizar(selecionando, "seletor", s);
            setSelecionando(null);
            toast.success("Item destacado definido.");
          }}
          onCancelar={() => setSelecionando(null)}
        />
      )}
      <Sheet open={aberto && !selecionando} onOpenChange={(o) => !o && onFechar()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Editar ajuda — {tela.rota}</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <div>
              <Label>Nome da tela</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div>
              <Label>O que esta tela faz</Label>
              <Textarea rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm font-medium">Passos ({passos.length})</p>
            <Button size="sm" variant="outline" onClick={() => void adicionar()}>
              <Plus className="mr-1 h-4 w-4" /> Passo
            </Button>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Clique em um passo e aperte Ctrl + V para colar um print da área de transferência.
          </p>

          {carregando && <Loader2 className="mt-6 h-5 w-5 animate-spin text-muted-foreground" />}

          <div className="mt-3 space-y-3 pb-24">
            {passos.map((p, i) => (
              <Card
                key={p.id}
                onClick={() => setFoco(p.id)}
                className={foco === p.id ? "border-primary" : undefined}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Passo {i + 1}</span>
                    <div className="ml-auto flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => mover(i, -1)} aria-label="Subir">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => mover(i, 1)} aria-label="Descer">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void remover(p.id)}
                        aria-label="Excluir passo"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={p.titulo}
                    placeholder="Título do passo"
                    onChange={(e) => atualizar(p.id, "titulo", e.target.value)}
                  />
                  <Textarea
                    rows={3}
                    value={p.texto}
                    placeholder="Explicação"
                    onChange={(e) => atualizar(p.id, "texto", e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelecionando(p.id)}>
                      <Crosshair className="mr-1 h-4 w-4" />
                      {p.seletor ? "Trocar item destacado" : "Destacar item da tela"}
                    </Button>
                    {p.seletor && (
                      <Button size="sm" variant="ghost" onClick={() => atualizar(p.id, "seletor", null)}>
                        Sem destaque
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFoco(p.id);
                        arquivoRef.current?.click();
                      }}
                    >
                      <ImagePlus className="mr-1 h-4 w-4" /> Print
                    </Button>
                  </div>
                  {p.imagem_url && (
                    <div className="space-y-1">
                      <img
                        src={p.imagem_url}
                        alt="Print do passo"
                        className="max-h-40 w-full rounded border object-contain"
                      />
                      <Button size="sm" variant="ghost" onClick={() => atualizar(p.id, "imagem_url", null)}>
                        Remover print
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <input
            ref={arquivoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              const alvo = focoRef.current;
              if (f && alvo) void aplicarImagem(f, alvo);
              e.target.value = "";
            }}
          />

          <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t bg-background px-6 py-3">
            <Button variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarTudo()} disabled={salvando}>
              {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Salvar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
