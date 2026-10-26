import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { dvrsQuery } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ComboSelect } from "@/components/ComboSelect";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";
import { Maximize2, Minimize2, Search, X } from "lucide-react";
import { PlayerGravacao } from "@/components/PlayerGravacao";

export const Route = createFileRoute("/_authenticated/reproducao")({
  head: () => ({
    meta: [
      { title: "Reprodução de gravações — Sentinela VIEW" },
      {
        name: "description",
        content: "Consulte e reproduza as gravações guardadas no servidor local, por DVR e câmera.",
      },
      { property: "og:title", content: "Reprodução de gravações — Sentinela VIEW" },
      { property: "og:description", content: "Reproduza gravações do servidor local por período." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReproducaoPage,
});

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function inicioDoDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toLocalInput(d);
}

const MAXIMO_PERIODO_MS = 24 * 60 * 60 * 1000;


function ReproducaoPage() {
  const dvrs = useQuery(dvrsQuery);
  const { clienteId: clienteGlobal, setClienteId, clientes, bloqueado } = useClienteSelecionado();
  const [dvrId, setDvrId] = useState("todos");
  const [canais, setCanais] = useState<string[]>([]);
  const [de, setDe] = useState(inicioDoDia());
  const [ate, setAte] = useState(toLocalInput(new Date()));
  const [erroPeriodo, setErroPeriodo] = useState("");
  const [filtro, setFiltro] = useState<{
    clienteId: string | null;
    dvrId: string;
    canais: string[];
    de: string;
    ate: string;
  }>({ clienteId: clienteGlobal, dvrId: "todos", canais: [], de, ate });
  const [buscou, setBuscou] = useState(false);
  const [ocultas, setOcultas] = useState<string[]>([]);
  const [telaCheia, setTelaCheia] = useState(false);

  useEffect(() => {
    setDvrId("todos");
    setCanais([]);
    setFiltro((f) => ({ ...f, clienteId: clienteGlobal, dvrId: "todos", canais: [] }));
  }, [clienteGlobal]);

  useEffect(() => {
    if (!telaCheia) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTelaCheia(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [telaCheia]);

  const TAMANHO_PAGINA = 500;
  const arquivos = useInfiniteQuery({
    queryKey: ["arquivos-gravados", filtro],
    enabled: buscou,
    initialPageParam: null as { inicio: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      // Segmentos que INTERSECTAM [de, ate): inicio < ate  e  (fim > de ou fim nulo).
      const de = new Date(filtro.de).toISOString();
      const ate = new Date(filtro.ate).toISOString();
      let q = supabase
        .from("arquivos_gravados")
        .select("*, dvrs(nome)", pageParam ? {} : { count: "exact" })
        .eq("disponivel", true)
        .lt("inicio", ate)
        .or(`fim.gt.${de},and(fim.is.null,inicio.gte.${de})`)
        .order("inicio", { ascending: true })
        .order("id", { ascending: true })
        .limit(TAMANHO_PAGINA);
      if (filtro.clienteId) q = q.eq("cliente_id", filtro.clienteId);
      if (filtro.dvrId !== "todos") q = q.eq("dvr_id", filtro.dvrId);
      if (filtro.canais.length) q = q.in("canal", filtro.canais.map(Number));
      if (pageParam) {
        // Cursor estável (inicio, id) crescente: começa pela mais antiga.
        q = q.or(
          `inicio.gt.${pageParam.inicio},and(inicio.eq.${pageParam.inicio},id.gt.${pageParam.id})`,
        );
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { linhas: data ?? [], total: count ?? null };
    },
    getNextPageParam: (ultima) => {
      if (ultima.linhas.length < TAMANHO_PAGINA) return undefined;
      const u = ultima.linhas[ultima.linhas.length - 1]!;
      return { inicio: u.inicio, id: u.id };
    },
  });

  const dvrsFiltrados = (dvrs.data ?? []).filter(
    (d) => !clienteGlobal || d.cliente_id === clienteGlobal,
  );
  const dvrEscolhido = dvrsFiltrados.find((d) => d.id === dvrId);
  // Só oferece as câmeras que estão configuradas para gravar neste DVR.
  const canaisDoDvr = (() => {
    if (!dvrEscolhido) return [];
    const total = dvrEscolhido.canais ?? 0;
    const d = dvrEscolhido as { gravar_todos_canais?: boolean | null; canais_gravacao?: unknown };
    if (d.gravar_todos_canais === true) {
      return Array.from({ length: total }, (_, i) => String(i + 1));
    }
    const cfg = Array.isArray(d.canais_gravacao) ? d.canais_gravacao : [];
    return cfg
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= total)
      .sort((a, b) => a - b)
      .map(String);
  })();

  const paginas = arquivos.data?.pages ?? [];
  const totalConhecido = paginas[0]?.total ?? null;
  // Deduplica por id (páginas podem se sobrepor se o catálogo mudar no meio).
  const lista = (() => {
    const vistos = new Set<string>();
    const saida: (typeof paginas)[number]["linhas"] = [];
    for (const p of paginas) for (const a of p.linhas) {
      if (vistos.has(a.id)) continue;
      vistos.add(a.id);
      saida.push(a);
    }
    return saida;
  })();

  const duracaoDe = (a: (typeof lista)[number]) =>
    a.duracao_segundos ??
    (a.fim ? Math.max(0, (+new Date(a.fim) - +new Date(a.inicio)) / 1000) : 0);

  // Uma "caixa" de reprodução por câmera selecionada com gravação no período.
  const camerasComGravacao = (() => {
    const mapa = new Map<
      string,
      { chave: string; nomeDvr: string; camera: string; trechos: typeof lista }
    >();
    for (const a of lista) {
      if (!a.disponivel) continue;
      const chave = `${a.dvr_id ?? "—"}:${a.canal ?? 0}`;
      const nomeDvr = (a as { dvrs?: { nome: string } }).dvrs?.nome ?? a.dvr_nome ?? "—";
      const camera = a.camera_nome ?? (a.canal ? `Canal ${a.canal}` : "—");
      const atual = mapa.get(chave) ?? { chave, nomeDvr, camera, trechos: [] as typeof lista };
      atual.trechos.push(a);
      mapa.set(chave, atual);
    }
    return Array.from(mapa.values())
      .map((c) => ({
        ...c,
        trechos: [...c.trechos].sort((x, y) => +new Date(x.inicio) - +new Date(y.inicio)),
      }))
      .sort((a, b) => a.camera.localeCompare(b.camera));
  })();

  const visiveis = camerasComGravacao.filter((c) => !ocultas.includes(c.chave));
  const colunas = Math.max(1, Math.ceil(Math.sqrt(visiveis.length || 1)));

  const alterarDe = (valor: string) => {
    setDe(valor);
    setErroPeriodo("");
    const inicio = +new Date(valor);
    const fim = +new Date(ate);
    if (Number.isFinite(inicio) && (!Number.isFinite(fim) || fim < inicio || fim - inicio > MAXIMO_PERIODO_MS)) {
      setAte(toLocalInput(new Date(inicio + MAXIMO_PERIODO_MS)));
    }
  };

  const alterarAte = (valor: string) => {
    setAte(valor);
    setErroPeriodo("");
    const inicio = +new Date(de);
    const fim = +new Date(valor);
    if (Number.isFinite(fim) && (!Number.isFinite(inicio) || fim < inicio || fim - inicio > MAXIMO_PERIODO_MS)) {
      setDe(toLocalInput(new Date(fim - MAXIMO_PERIODO_MS)));
    }
  };

  const buscar = () => {
    const inicio = +new Date(de);
    const fim = +new Date(ate);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio || fim - inicio > MAXIMO_PERIODO_MS) {
      setErroPeriodo("Selecione um período de até 24 horas.");
      return;
    }
    if (dvrId === "todos") {
      setErroPeriodo("Selecione o DVR antes de buscar.");
      return;
    }
    if (canaisDoDvr.length === 0) {
      setErroPeriodo("Este DVR não tem câmeras configuradas para gravar.");
      return;
    }
    const validos = canais.filter((c) => canaisDoDvr.includes(c));
    if (validos.length === 0) {
      setErroPeriodo("Selecione ao menos uma câmera que grave.");
      return;
    }
    setErroPeriodo("");
    setOcultas([]);
    setBuscou(true);
    setFiltro({ clienteId: clienteGlobal, dvrId, canais: validos, de, ate });
  };

  if (telaCheia) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black p-2">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 bg-black/50 p-0 text-white hover:bg-black/70"
            onClick={() => setTelaCheia(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div
          className="grid h-full w-full gap-1"
          style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}
        >
          {visiveis.map((c) => (
            <PlayerGravacao
              key={c.chave}
              titulo={`${c.nomeDvr} · ${c.camera}`}
              semCabecalho
              trechos={c.trechos.map((a) => ({
                id: a.id,
                inicio: a.inicio,
                duracaoSegundos: duracaoDe(a),
                inicioEpochMs: (a as { inicio_epoch_ms?: number | null }).inicio_epoch_ms ?? null,
                urlLocal: (a as { download_url?: string | null }).download_url ?? null,
              }))}
              indiceInicial={0}
              posicaoInicial={0}
              onFechar={() => setOcultas((o) => [...o, c.chave])}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reprodução"
        description="Consulte as gravações guardadas no servidor local e reproduza sem acessar o DVR."
        actions={
          visiveis.length > 0 ? (
            <Button variant="outline" onClick={() => setTelaCheia(true)}>
              <Maximize2 className="mr-2 h-4 w-4" /> Tela cheia
            </Button>
          ) : undefined
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <ComboSelect
                  value={clienteGlobal}
                  onChange={setClienteId}
                  disabled={bloqueado}
                  options={clientes.map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Selecione o cliente"
                  searchPlaceholder="Pesquisar cliente..."
                />
              </div>
              <div className="space-y-2">
                <Label>DVR</Label>
                <ComboSelect
                  value={dvrId}
                  onChange={(v) => {
                    setDvrId(v);
                    setCanais([]);
                  }}
                  options={[
                    { value: "todos", label: "Selecione o DVR" },
                    ...dvrsFiltrados.map((d) => ({ value: d.id, label: d.nome })),
                  ]}
                  searchPlaceholder="Pesquisar DVR..."
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Câmeras</Label>
                  {canaisDoDvr.length > 0 && (
                    <div className="flex gap-2 text-[11px]">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setCanais(canaisDoDvr)}
                      >
                        Todas
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => setCanais([])}
                      >
                        Nenhuma
                      </button>
                    </div>
                  )}
                </div>
                <ComboMultiSelect
                  values={canais}
                  onChange={setCanais}
                  disabled={dvrId === "todos" || canaisDoDvr.length === 0}
                  options={canaisDoDvr.map((c) => ({ value: c, label: `Canal ${c}` }))}
                  placeholder="Selecione as câmeras"
                  searchPlaceholder="Pesquisar câmera..."
                />
                {dvrEscolhido && canaisDoDvr.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma câmera está configurada para gravar neste DVR.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>De</Label>
                <Input
                  type="datetime-local"
                  value={de}
                  max={ate}
                  onChange={(e) => alterarDe(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Até</Label>
                <Input
                  type="datetime-local"
                  value={ate}
                  min={de}
                  max={de ? toLocalInput(new Date(+new Date(de) + MAXIMO_PERIODO_MS)) : undefined}
                  onChange={(e) => alterarAte(e.target.value)}
                />
              </div>
              {erroPeriodo && <p className="text-xs text-destructive">{erroPeriodo}</p>}
              {buscou && (
                <div className="space-y-2 rounded-md border p-2 text-xs text-muted-foreground">
                  <p>
                    {arquivos.isFetching
                      ? "Carregando..."
                      : `${lista.length}${totalConhecido !== null ? ` de ${totalConhecido}` : ""} trechos carregados`}
                  </p>
                  {arquivos.hasNextPage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={arquivos.isFetchingNextPage}
                      onClick={() => void arquivos.fetchNextPage()}
                    >
                      Carregar mais recentes
                    </Button>
                  ) : (
                    !arquivos.isFetching && lista.length > 0 && <p>Fim dos resultados.</p>
                  )}
                </div>
              )}
              <Button className="w-full" onClick={buscar}>
                <Search className="mr-2 h-4 w-4" /> Buscar
              </Button>
            </CardContent>
          </Card>
        </div>

        {visiveis.length > 0 ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}
          >
            {visiveis.map((c) => (
              <PlayerGravacao
                key={c.chave}
                titulo={`${c.nomeDvr} · ${c.camera}`}
                trechos={c.trechos.map((a) => ({
                  id: a.id,
                  inicio: a.inicio,
                  duracaoSegundos: duracaoDe(a),
                  inicioEpochMs: (a as { inicio_epoch_ms?: number | null }).inicio_epoch_ms ?? null,
                  urlLocal: (a as { download_url?: string | null }).download_url ?? null,
                }))}
                indiceInicial={0}
                posicaoInicial={0}
                onFechar={() => setOcultas((o) => [...o, c.chave])}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex min-h-[420px] items-center justify-center text-center text-sm text-muted-foreground">
              {arquivos.isFetching
                ? "Procurando gravações no período..."
                : buscou
                  ? "Nenhuma gravação encontrada para as câmeras e o período selecionados."
                  : "Selecione o DVR, as câmeras e o período e clique em Buscar."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

