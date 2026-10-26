import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorCog, Play, Save, ScanEye, Trash2, Pencil, Star } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ComboSelect } from "@/components/ComboSelect";

export type MonitorSalvo = {
  id: string;
  numero: number;
  rotulo: string;
  left: number;
  top: number;
  width: number;
  height: number;
  principal: boolean;
  /** nome definido pelo supervisor, separado do rótulo detectado pelo sistema */
  nomePersonalizado?: string | undefined;
  /** mosaico que deve abrir neste monitor (definido pelo supervisor) */
  layoutId?: string | null;
};

export type SessaoMonitor = {
  id: string;
  userId: string;
  usuario: string;
  email: string;
  clienteId: string | null;
  layoutId: string | null;
  layoutNome: string;
  numeroTela: number;
  monitores: MonitorSalvo[] | null;
  monitorNumero: number | null;
  previa?: string | null;
};

type LayoutBasico = { id: string; nome: string; cliente_id: string | null };
type ClienteBasico = { id: string; nome: string };

type Organizacao = {
  user_id: string;
  cliente_id: string | null;
  monitores: MonitorSalvo[];
};

/** tabela nova: os tipos gerados do banco não podem ser editados aqui */
const tabelaOrganizacao = () =>
  (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            v: string,
          ) => {
            maybeSingle: () => Promise<{ data: Organizacao | null; error: { message: string } | null }>;
          };
        };
        upsert: (
          v: Record<string, unknown>,
          o: { onConflict: string },
        ) => Promise<{ error: { message: string } | null }>;
        delete: () => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    }
  ).from("organizacao_telas");

/** encaixa a borda do monitor arrastado nas bordas dos vizinhos */
function encaixar(alvo: MonitorSalvo, outros: MonitorSalvo[]) {
  const tolerancia = Math.max(60, Math.round(alvo.width * 0.12));
  let { left, top } = alvo;
  for (const o of outros) {
    const candidatosX = [o.left + o.width, o.left - alvo.width, o.left];
    const candidatosY = [o.top + o.height, o.top - alvo.height, o.top];
    for (const x of candidatosX) if (Math.abs(left - x) < tolerancia) left = x;
    for (const y of candidatosY) if (Math.abs(top - y) < tolerancia) top = y;
  }
  return { ...alvo, left: Math.round(left), top: Math.round(top) };
}

/**
 * Escolhe um cliente, depois um usuário, e mostra os monitores daquele
 * usuário com o mosaico de cada um. Os monitores podem ser arrastados
 * (como nas configurações de vídeo do Windows) e a organização fica salva.
 */
export function OrganizacaoTelas({
  sessoes,
  clientes,
  layouts,
  podeControlar,
  onIdentificar,
  onIniciar,
  usuarioInicial,
}: {
  sessoes: SessaoMonitor[];
  clientes: ClienteBasico[];
  layouts: LayoutBasico[];
  podeControlar: boolean;
  usuarioInicial?: string | undefined;
  onIdentificar: (userId: string) => void;
  onIniciar: (userId: string) => void;
}) {
  const qc = useQueryClient();
  const [cliente, setCliente] = useState("");
  const [usuario, setUsuario] = useState("");
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<MonitorSalvo[]>([]);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const arrasto = useRef<{ id: string; x: number; y: number; left: number; top: number } | null>(
    null,
  );
  /** monitor ampliado no momento (clique para ampliar, clique/Esc para fechar) */
  const [ampliado, setAmpliado] = useState<string | null>(null);
  /** virou arrasto? evita ampliar quando o clique termina um arrasto */
  const moveu = useRef(false);

  const sessoesDoCliente = useMemo(
    () => sessoes.filter((s) => !cliente || s.clienteId === cliente),
    [sessoes, cliente],
  );

  const usuarios = useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; telas: number }>();
    for (const s of sessoesDoCliente) {
      const atual = mapa.get(s.userId);
      if (atual) atual.telas += 1;
      else mapa.set(s.userId, { id: s.userId, nome: s.usuario || s.email, telas: 1 });
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [sessoesDoCliente]);

  useEffect(() => {
    if (usuario && !usuarios.some((u) => u.id === usuario)) setUsuario("");
    if (!usuario && usuarioInicial && usuarios.some((u) => u.id === usuarioInicial)) {
      setUsuario(usuarioInicial);
    }
  }, [usuarios, usuario, usuarioInicial]);

  const sessoesDoUsuario = useMemo(
    () =>
      sessoes
        .filter((s) => s.userId === usuario)
        .sort((a, b) => a.numeroTela - b.numeroTela),
    [sessoes, usuario],
  );

  const organizacao = useQuery({
    queryKey: ["organizacao-telas", usuario],
    enabled: !!usuario,
    queryFn: async () => {
      const { data, error } = await tabelaOrganizacao().select("*").eq("user_id", usuario).maybeSingle();
      if (error) return null;
      return data;
    },
  });

  // monitores detectados: a sessão mais completa manda
  const detectados = useMemo(() => {
    let melhor: MonitorSalvo[] = [];
    for (const s of sessoesDoUsuario) {
      const lista = s.monitores ?? [];
      if (lista.length > melhor.length) melhor = lista;
    }
    return melhor;
  }, [sessoesDoUsuario]);

  const salvos = organizacao.data?.monitores ?? [];

  const monitores = useMemo(() => {
    if (editando) return rascunho;
    if (salvos.length) {
      // mantém a posição salva, mas atualiza o que o computador informou agora
      return salvos.map((s) => {
        const atual = detectados.find((d) => d.id === s.id);
        return atual
          ? {
              ...atual,
              left: s.left,
              top: s.top,
              nomePersonalizado: s.nomePersonalizado,
              layoutId: s.layoutId ?? null,
            }
          : s;
      });
    }
    return detectados;
  }, [editando, rascunho, salvos, detectados]);

  const quantidadeParaIniciar = useMemo(
    () => monitores.filter((monitor) => !!monitor.layoutId).length,
    [monitores],
  );

  const caixa = useMemo(() => {
    if (!monitores.length) return null;
    const minX = Math.min(...monitores.map((m) => m.left));
    const minY = Math.min(...monitores.map((m) => m.top));
    const maxX = Math.max(...monitores.map((m) => m.left + m.width));
    const maxY = Math.max(...monitores.map((m) => m.top + m.height));
    const margemX = (maxX - minX) * 0.08;
    const margemY = (maxY - minY) * 0.08;
    return {
      minX: minX - margemX,
      minY: minY - margemY,
      largura: maxX - minX + margemX * 2 || 1,
      altura: maxY - minY + margemY * 2 || 1,
    };
  }, [monitores]);

  const telaDoMonitor = (m: MonitorSalvo) =>
    sessoesDoUsuario.find((s) => s.monitorNumero === m.numero) ?? null;

  const opcoesMosaico = useMemo(
    () => [
      { value: "", label: "Sem mosaico definido" },
      ...layouts
        .filter((l) => !cliente || !l.cliente_id || l.cliente_id === cliente)
        .map((l) => ({ value: l.id, label: l.nome })),
    ],
    [layouts, cliente],
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await tabelaOrganizacao().upsert(
        {
          user_id: usuario,
          cliente_id: cliente || null,
          monitores: rascunho,
          atualizado_por: auth.user?.id ?? null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Organização das telas salva.");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["organizacao-telas", usuario] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async () => {
      const { error } = await tabelaOrganizacao().delete().eq("user_id", usuario);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Organização removida. O usuário volta ao comportamento automático.");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["organizacao-telas", usuario] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const favoritar = useMutation({
    mutationFn: async (m: MonitorSalvo) => {
      const tela = telaDoMonitor(m);
      const layoutAtual = m.layoutId ?? tela?.layoutId ?? null;
      const salvoAtual = salvos.find((s) => s.id === m.id);
      const jaFavorito = !!salvoAtual?.layoutId && salvoAtual.layoutId === layoutAtual;
      const novoLayout = jaFavorito ? null : layoutAtual;
      if (!jaFavorito && !novoLayout) throw new Error("Escolha um mosaico para esta tela antes de favoritar.");
      const base = (editando ? rascunho : monitores).map((x) => ({ ...x }));
      const lista = base.map((x) => (x.id === m.id ? { ...x, layoutId: novoLayout } : x));
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await tabelaOrganizacao().upsert(
        { user_id: usuario, cliente_id: cliente || null, monitores: lista, atualizado_por: auth.user?.id ?? null },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
      if (editando) setRascunho(lista);
      return !jaFavorito;
    },
    onSuccess: (fav) => {
      toast.success(fav ? "Tela favoritada: abrirá sempre com este mosaico." : "Favorito removido desta tela.");
      qc.invalidateQueries({ queryKey: ["organizacao-telas", usuario] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const comecarEdicao = () => {
    setRascunho(monitores.map((m) => ({ ...m })));
    setEditando(true);
  };

  // Esc fecha a visualização ampliada do monitor
  useEffect(() => {
    if (!ampliado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAmpliado(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ampliado]);

  // monitor saiu da lista: fecha a ampliação
  useEffect(() => {
    if (ampliado && !monitores.some((m) => m.id === ampliado)) setAmpliado(null);
  }, [ampliado, monitores]);

  const aoArrastar = (e: React.PointerEvent, m: MonitorSalvo) => {
    moveu.current = false;
    if (!editando || !caixa || !areaRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { id: m.id, x: e.clientX, y: e.clientY, left: m.left, top: m.top };
  };

  const aoMover = (e: React.PointerEvent) => {
    const a = arrasto.current;
    const area = areaRef.current;
    if (!a || !caixa || !area) return;
    if (Math.abs(e.clientX - a.x) > 5 || Math.abs(e.clientY - a.y) > 5) moveu.current = true;
    const escala = caixa.largura / area.clientWidth;
    const left = Math.round(a.left + (e.clientX - a.x) * escala);
    const top = Math.round(a.top + (e.clientY - a.y) * escala);
    setRascunho((atual) => atual.map((m) => (m.id === a.id ? { ...m, left, top } : m)));
  };

  const aoSoltar = () => {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a) return;
    setRascunho((atual) => {
      const alvo = atual.find((m) => m.id === a.id);
      if (!alvo) return atual;
      const ajustado = encaixar(alvo, atual.filter((m) => m.id !== a.id));
      return atual.map((m) => (m.id === a.id ? ajustado : m));
    });
  };

  const definirMosaico = (monitorId: string, layoutId: string) => {
    setRascunho((atual) =>
      atual.map((m) => (m.id === monitorId ? { ...m, layoutId: layoutId || null } : m)),
    );
  };

  const definirNomePersonalizado = (monitorId: string, nome: string) => {
    setRascunho((atual) =>
      atual.map((m) =>
        m.id === monitorId ? { ...m, nomePersonalizado: nome.slice(0, 60) } : m,
      ),
    );
  };

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorCog className="h-4 w-4" />
            Telas do usuário
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha o cliente e o usuário, veja os monitores dele e arraste para organizar as telas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!!sessoesDoUsuario.length && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!podeControlar}
              onClick={() => onIdentificar(usuario)}
            >
              <ScanEye className="h-4 w-4" />
              Identificar monitores
            </Button>
          )}
          {!!usuario && !editando && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!podeControlar || !quantidadeParaIniciar}
              onClick={() => onIniciar(usuario)}
            >
              <Play className="h-4 w-4" />
              Iniciar mosaicos
            </Button>
          )}
          {!!usuario && !editando && (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!podeControlar} onClick={comecarEdicao}>
              <Pencil className="h-4 w-4" />
              {salvos.length ? "Editar organização" : "Organizar telas"}
            </Button>
          )}
          {!!usuario && !editando && !!salvos.length && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={!podeControlar || remover.isPending}
              onClick={() => remover.mutate()}
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </Button>
          )}
          {editando && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button size="sm" className="gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                <Save className="h-4 w-4" />
                Salvar organização
              </Button>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="w-full sm:w-64">
            <ComboSelect
              value={cliente}
              onChange={(v) => {
                setCliente(v);
                setEditando(false);
              }}
              options={[
                { value: "", label: "Todos os clientes" },
                ...clientes.map((c) => ({ value: c.id, label: c.nome })),
              ]}
              placeholder="Todos os clientes"
              searchPlaceholder="Pesquisar cliente..."
            />
          </div>
          <div className="w-full sm:w-72">
            <ComboSelect
              value={usuario}
              onChange={(v) => {
                setUsuario(v);
                setEditando(false);
              }}
              options={[
                { value: "", label: "Escolha o usuário" },
                ...usuarios.map((u) => ({
                  value: u.id,
                  label: `${u.nome} (${u.telas} tela${u.telas === 1 ? "" : "s"})`,
                })),
              ]}
              placeholder="Escolha o usuário"
              searchPlaceholder="Pesquisar usuário..."
            />
          </div>
          {!!salvos.length && !editando && (
            <Badge variant="secondary" className="self-center">
              Organização salva
            </Badge>
          )}
        </div>

        {!usuario && (
          <p className="text-sm text-muted-foreground">
            Selecione um usuário para ver os monitores dele.
          </p>
        )}

        {!!usuario && !monitores.length && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Este usuário ainda não informou os monitores. No computador dele, clique no cadeado ao
            lado do endereço do site e libere <strong>Gerenciamento de janelas</strong>.
          </div>
        )}

        {caixa && !!monitores.length && (
          <div
            ref={areaRef}
            className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-md border bg-muted/40"
            style={{ aspectRatio: `${caixa.largura} / ${caixa.altura}`, maxHeight: 320 }}
          >
            {monitores.map((m) => {
              const tela = telaDoMonitor(m);
              const mosaico = layouts.find((l) => l.id === (m.layoutId ?? tela?.layoutId))?.nome;
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    if (moveu.current) return;
                    setAmpliado((a) => (a === m.id ? null : m.id));
                  }}
                  onPointerDown={(e) => aoArrastar(e, m)}
                  onPointerMove={aoMover}
                  onPointerUp={aoSoltar}
                  onPointerCancel={aoSoltar}
                  className={`absolute isolate flex min-h-0 min-w-0 select-none flex-col items-center justify-center overflow-hidden rounded-md border-2 px-1 py-0.5 text-center ${
                    editando ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
                  } ${m.layoutId || tela ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                  style={{
                    left: `${((m.left - caixa.minX) / caixa.largura) * 100}%`,
                    top: `${((m.top - caixa.minY) / caixa.altura) * 100}%`,
                    width: `${(m.width / caixa.largura) * 100}%`,
                    height: `${(m.height / caixa.altura) * 100}%`,
                  }}
                >
                  {tela?.previa && (
                    <img
                      src={tela.previa}
                      alt={`Prévia do monitor ${m.numero}`}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover -z-10 opacity-60"
                    />
                  )}
                  <strong className="relative shrink-0 text-xl leading-none">{m.numero || "?"}</strong>
                  <p className="w-full shrink-0 truncate text-[9px] leading-[11px] text-muted-foreground">
                    {Math.round(m.width)}×{Math.round(m.height)}
                  </p>
                  {m.principal && (
                    <Badge variant="secondary" className="h-3.5 shrink-0 px-1 py-0 text-[8px] leading-none">
                      Principal
                    </Badge>
                  )}
                  {m.nomePersonalizado?.trim() && (
                    <p className="w-full shrink-0 truncate text-[9px] font-medium leading-[11px]">
                      {m.nomePersonalizado.trim()}
                    </p>
                  )}
                  {mosaico && (
                    <p className="w-full shrink-0 truncate text-[9px] font-medium leading-[11px] text-primary">
                      {mosaico}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(() => {
          const am = monitores.find((x) => x.id === ampliado) ?? null;
          if (!am) return null;
          const telaAm = telaDoMonitor(am);
          const mosaicoAm = layouts.find((l) => l.id === (am.layoutId ?? telaAm?.layoutId))?.nome;
          return (
            <div
              role="dialog"
              aria-label={`Monitor ${am.numero || "?"} ampliado`}
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
              onClick={() => setAmpliado(null)}
            >
              <div
                className="w-full max-w-2xl rounded-lg border bg-background p-4 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Monitor {am.numero || "?"}
                      {am.nomePersonalizado?.trim() ? ` — ${am.nomePersonalizado.trim()}` : ""}
                      {am.principal && (
                        <span className="ml-2 text-xs text-muted-foreground">principal</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Identificado: {am.rotulo} · {Math.round(am.width)}×{Math.round(am.height)} ·{" "}
                      {telaAm ? telaAm.layoutNome || "sem mosaico" : "sem tela aberta"}
                    </p>
                  </div>
                  {mosaicoAm && (
                    <Badge variant="secondary" className="max-w-56 truncate">
                      {mosaicoAm}
                    </Badge>
                  )}
                </div>
                <div
                  className={`relative mx-auto flex flex-col items-center justify-center overflow-hidden rounded-md border-2 ${
                    am.layoutId || telaAm ? "border-primary bg-primary/10" : "border-border bg-muted/40"
                  }`}
                  style={{
                    aspectRatio: `${am.width} / ${am.height}`,
                    width: `min(100%, ${((am.width / am.height) * 55).toFixed(2)}vh)`,
                  }}
                >
                  {telaAm?.previa && (
                    <img
                      src={telaAm.previa}
                      alt={`Prévia do monitor ${am.numero || "?"}`}
                      className="absolute inset-0 h-full w-full object-cover opacity-70"
                    />
                  )}
                  <strong className="relative text-6xl leading-none">{am.numero || "?"}</strong>
                  {am.nomePersonalizado?.trim() && (
                    <p className="relative mt-2 text-lg font-medium">{am.nomePersonalizado.trim()}</p>
                  )}
                  {mosaicoAm && (
                    <p
                      className={`relative font-medium text-primary ${
                        am.nomePersonalizado?.trim() ? "mt-1 text-sm" : "mt-2 text-lg"
                      }`}
                    >
                      {mosaicoAm}
                    </p>
                  )}
                  <p className="relative mt-1 text-sm text-muted-foreground">
                    {Math.round(am.width)}×{Math.round(am.height)}
                  </p>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Clique fora ou pressione Esc para voltar.
                </p>
              </div>
            </div>
          );
        })()}

        {editando && (
          <p className="text-center text-xs text-muted-foreground">
            Arraste os monitores para reproduzir a posição real e escolha o mosaico de cada um.
          </p>
        )}

        {monitores.map((m) => {
          const tela = telaDoMonitor(m);
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <div className="min-w-56 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="shrink-0 text-sm font-medium">
                    Monitor {m.numero || "?"}
                    {m.principal && <span className="ml-2 text-xs text-muted-foreground">principal</span>}
                  </p>
                  {editando ? (
                    <Input
                      value={m.nomePersonalizado ?? ""}
                      onChange={(e) => definirNomePersonalizado(m.id, e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      placeholder="Nome personalizado"
                      aria-label={`Nome personalizado do monitor ${m.numero || "?"}`}
                      maxLength={60}
                      className="h-8 w-full sm:w-56"
                    />
                  ) : m.nomePersonalizado?.trim() ? (
                    <span className="text-sm font-medium">— {m.nomePersonalizado.trim()}</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Identificado: {m.rotulo} · {tela ? tela.layoutNome || "sem mosaico" : "sem tela aberta"}
                </p>
              </div>
              <div className="w-full sm:w-72">
                <ComboSelect
                  value={m.layoutId ?? ""}
                  onChange={(v) => definirMosaico(m.id, v)}
                  options={opcoesMosaico}
                  disabled={!editando}
                  placeholder="Sem mosaico definido"
                  searchPlaceholder="Pesquisar mosaico..."
                />
              </div>
              {(() => {
                const salvo = salvos.find((x) => x.id === m.id);
                const atual = m.layoutId ?? tela?.layoutId ?? null;
                const fav = !!salvo?.layoutId && salvo.layoutId === atual;
                return (
                  <Button
                    variant="ghost"
                    size="icon"
                    title={fav ? "Remover favorito" : "Favoritar esta tela com este mosaico"}
                    disabled={!podeControlar || favoritar.isPending}
                    onClick={() => favoritar.mutate(m)}
                  >
                    <Star className={`h-5 w-5 ${fav ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                  </Button>
                );
              })()}
              {!editando && (
                <span className="text-xs text-muted-foreground">
                  Clique em “{salvos.length ? "Editar organização" : "Organizar telas"}” para alterar
                </span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
