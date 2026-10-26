import { useCallback, useEffect, useMemo, useState } from "react";
import { MonitorPlay, Play, RefreshCw, ScanEye } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ComboSelect } from "@/components/ComboSelect";
import { useAuth } from "@/lib/auth";
import {
  abrirTelaAgora,
  abrirIdentificacoesMonitores,
  encontrarMonitor,
  janelaDaTela,
  listarMonitores,
  monitoresAutorizados,
  ouvirMudancaDeMonitores,
  salvarTela,
  salvarTelaRemota,
  suportaMonitores,
  telaEstaViva,
  type MonitorInfo,
  type TelaExtra,
} from "@/lib/telas-extras";

type LayoutBasico = {
  id: string;
  nome: string;
  cliente_id: string | null;
};

type MonitorSalvoRemoto = { id: string; layoutId?: string | null };

type ConfigMonitor = {
  telaId: string;
  layoutId: string;
  clienteId: string | null;
  telaCheia: boolean;
};

const CHAVE = "sentinela:mapa-monitores";

function lerConfig(): Record<string, ConfigMonitor> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as Record<string, ConfigMonitor>) : {};
  } catch {
    return {};
  }
}

function gravarConfig(config: Record<string, ConfigMonitor>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(config));
  } catch {
    /* sem espaço: a escolha vale só nesta sessão */
  }
}

function novoId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return `tela-${crypto.randomUUID()}`;
  return `tela-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function corrigirIdsDuplicados(
  atual: Record<string, ConfigMonitor>,
  monitores: MonitorInfo[],
): Record<string, ConfigMonitor> {
  const usados = new Set<string>();
  let mudou = false;
  const proximo = { ...atual };

  for (const monitor of monitores) {
    const existente = proximo[monitor.id];
    if (!existente) continue;
    if (!existente.telaId || usados.has(existente.telaId)) {
      proximo[monitor.id] = { ...existente, telaId: novoId() };
      mudou = true;
    }
    usados.add(proximo[monitor.id]?.telaId ?? "");
  }

  if (mudou) gravarConfig(proximo);
  return mudou ? proximo : atual;
}

/**
 * Mapa visual dos monitores conectados: o operador vê os monitores desenhados
 * na posição real, escolhe o mosaico de cada um e abre tudo com um clique.
 */
export function MapaMonitores({ layouts }: { layouts: LayoutBasico[] }) {
  const { user } = useAuth();
  const [monitores, setMonitores] = useState<MonitorInfo[]>([]);
  const [config, setConfig] = useState<Record<string, ConfigMonitor>>({});
  const [carregando, setCarregando] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  const [, setTick] = useState(0);

  const suportado = typeof window !== "undefined" && suportaMonitores();

  useEffect(() => {
    setConfig(lerConfig());
  }, []);

  /** Monitor de reserva quando o navegador não libera a lista completa. */
  const telaAtual = (): MonitorInfo[] => {
    if (typeof window === "undefined") return [];
    const s = window.screen;
    return [
      {
        numero: 1,
        id: `tela-atual|${s.width}x${s.height}`,
        posicaoId: "0:0",
        rotulo: "Tela atual",
        left: 0,
        top: 0,
        width: s.availWidth || s.width,
        height: s.availHeight || s.height,
        principal: true,
      },
    ];
  };

  const carregar = useCallback(async (pedirAgora: boolean): Promise<MonitorInfo[]> => {
    if (!suportaMonitores()) {
      if (pedirAgora) {
        const atual = telaAtual();
        setMonitores(atual);
        toast.info("Este navegador mostra só a tela atual.");
        return atual;
      }
      return [];
    }
    setCarregando(true);
    try {
      if (!pedirAgora && !(await monitoresAutorizados())) {
        setSemPermissao(true);
        return [];
      }
      const lista = await listarMonitores(true);
      if (lista.length) {
        setMonitores(lista);
        setConfig((atual) => corrigirIdsDuplicados(atual, lista));
        setSemPermissao(false);
        if (pedirAgora)
          toast.success(
            lista.length === 1
              ? "1 monitor encontrado neste computador."
              : `${lista.length} monitores encontrados neste computador.`,
          );
        return lista;
      } else {
        const atual = telaAtual();
        setMonitores(atual);
        setSemPermissao(true);
        if (pedirAgora) toast.info("Só foi possível reconhecer a tela atual.");
        return atual;
      }
    } catch {
      const atual = telaAtual();
      setMonitores(atual);
      setSemPermissao(true);
      if (pedirAgora)
        toast.error(
          "O navegador bloqueou a lista de monitores. Clique no cadeado ao lado do endereço e permita “Gerenciamento de janelas”.",
        );
      return atual;
    } finally {
      setCarregando(false);
    }
  }, []);


  useEffect(() => {
    void carregar(false);
  }, [carregar]);

  // organização definida pelo supervisor no Monitoramento: manda no mosaico
  // de cada monitor até que alguém edite ou remova.
  useEffect(() => {
    if (!user?.id || !monitores.length) return;
    let ativo = true;
    void (async () => {
      try {
        const { data } = await (
          supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (
                  col: string,
                  v: string,
                ) => {
                  maybeSingle: () => Promise<{
                    data: { monitores: MonitorSalvoRemoto[] } | null;
                  }>;
                };
              };
            };
          }
        )
          .from("organizacao_telas")
          .select("monitores")
          .eq("user_id", user.id)
          .maybeSingle();
        const salvos = data?.monitores ?? [];
        if (!ativo || !salvos.length) return;
        setConfig((atual) => {
          const proximo = { ...atual };
          let mudou = false;
          for (const salvo of salvos) {
            if (!salvo.layoutId) continue;
            const alvo = encontrarMonitor(monitores, salvo.id);
            if (!alvo) continue;
            const base = proximo[alvo.id];
            if (base?.layoutId === salvo.layoutId) continue;
            proximo[alvo.id] = {
              telaId: base?.telaId ?? novoId(),
              layoutId: salvo.layoutId,
              clienteId: base?.clienteId ?? null,
              telaCheia: base?.telaCheia !== false,
            };
            mudou = true;
          }
          if (mudou) gravarConfig(proximo);
          return mudou ? proximo : atual;
        });
      } catch {
        /* sem organização salva: segue a escolha local */
      }
    })();
    return () => {
      ativo = false;
    };
  }, [user?.id, monitores]);

  // monitor ligado/desligado ou movido: redesenha o mapa na hora
  useEffect(() => ouvirMudancaDeMonitores(() => void carregar(true)), [carregar]);

  // mantém os avisos de "aberta" atualizados
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const atualizar = (monitorId: string, mudanca: Partial<ConfigMonitor>) => {
    setConfig((atual) => {
      const anterior = atual[monitorId];
      const base: ConfigMonitor = anterior ?? {
        telaId: novoId(),
        layoutId: "",
        clienteId: null,
        telaCheia: true,
      };
      const proximo = { ...atual, [monitorId]: { ...base, ...mudanca } };
      gravarConfig(proximo);
      return proximo;
    });
  };

  const opcoes = useMemo(
    () => [
      { value: "", label: "Não abrir neste monitor" },
      ...layouts.map((l) => ({ value: l.id, label: l.nome })),
    ],
    [layouts],
  );

  const configurados = monitores.filter((m) => config[m.id]?.layoutId);

  const identificarMonitores = async () => {
    // Quando a lista já foi detectada, abre as identificações ainda dentro do
    // clique do usuário. Isso evita que o bloqueador de pop-ups aceite apenas
    // o primeiro monitor depois de uma espera assíncrona.
    const lista = monitores.length ? monitores : await carregar(true);
    if (!lista.length) return;

    const { abertas, bloqueadas } = abrirIdentificacoesMonitores(lista);

    if (abertas === lista.length) {
      toast.success(`Identificação exibida em ${abertas} monitor${abertas === 1 ? "" : "es"}.`);
    } else {
      toast.error(
        `${bloqueadas} identificação${bloqueadas === 1 ? " foi bloqueada" : " foram bloqueadas"}. Libere os pop-ups deste site.`,
      );
    }
  };

  const iniciar = () => {
    if (!configurados.length) {
      toast.error("Escolha um mosaico para pelo menos um monitor.");
      return;
    }
    let abertas = 0;
    let bloqueadas = 0;
    for (const monitor of configurados) {
      const c = config[monitor.id];
      if (!c) continue;
      const layout = layouts.find((l) => l.id === c.layoutId) ?? null;
      const tela: TelaExtra = {
        id: c.telaId,
        layoutId: c.layoutId,
        clienteId: layout?.cliente_id ?? c.clienteId ?? null,
        left: Math.round(monitor.left),
        top: Math.round(monitor.top),
        width: Math.round(monitor.width),
        height: Math.round(monitor.height),
        monitorId: monitor.id,
        monitorAbertura: monitor.id,
        telaCheia: c.telaCheia,
      };
      const jaAberta = janelaDaTela(tela.id);
      const janela = abrirTelaAgora(tela);
      if (!janela) {
        bloqueadas += 1;
        continue;
      }
      if (jaAberta) {
        // janela já existia: apenas recoloca no monitor certo
        try {
          janela.moveTo(tela.left, tela.top);
          janela.resizeTo(tela.width, tela.height);
          janela.focus();
        } catch {
          /* o navegador pode recusar mover a janela */
        }
      }
      salvarTela(tela);
      if (user?.id) void salvarTelaRemota(user.id, tela, true);
      abertas += 1;
    }
    if (abertas) toast.success(`${abertas} tela${abertas > 1 ? "s" : ""} no ar.`);
    if (bloqueadas)
      toast.error("O navegador bloqueou algumas janelas. Libere as janelas pop-up deste site.");
    setTick((n) => n + 1);
  };

  const caixa = useMemo(() => {
    if (!monitores.length) return null;
    const minX = Math.min(...monitores.map((m) => m.left));
    const minY = Math.min(...monitores.map((m) => m.top));
    const maxX = Math.max(...monitores.map((m) => m.left + m.width));
    const maxY = Math.max(...monitores.map((m) => m.top + m.height));
    return { minX, minY, largura: maxX - minX || 1, altura: maxY - minY || 1 };
  }, [monitores]);

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorPlay className="h-4 w-4" />
            Monitores deste computador
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha o mosaico de cada monitor e abra todas as telas de uma vez.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {monitores.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <MonitorPlay className="h-3.5 w-3.5" />
              {monitores.length === 1 ? "1 monitor" : `${monitores.length} monitores`}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={carregando}
            onClick={() => void carregar(true)}
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            Detectar
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={carregando}
            onClick={() => void identificarMonitores()}
          >
            <ScanEye className="h-4 w-4" />
            Identificar monitores
          </Button>

          <Button size="sm" className="gap-1.5" disabled={!configurados.length} onClick={iniciar}>
            <Play className="h-4 w-4" />
            Iniciar mosaicos
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!suportado && (
          <p className="text-sm text-muted-foreground">
            Este navegador não reconhece vários monitores. Use o Chrome ou o Edge para posicionar as
            telas automaticamente.
          </p>
        )}

        {suportado && semPermissao && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            O navegador ainda não liberou a lista completa de monitores, então só a tela atual
            aparece aqui. Clique em <strong>Detectar</strong> e escolha “Permitir”. Se nada for
            perguntado, clique no cadeado ao lado do endereço do site e libere{" "}
            <strong>Gerenciamento de janelas</strong>.
          </div>
        )}

        {caixa && (
          <div
            className="relative mx-auto w-full max-w-md overflow-hidden rounded-md border bg-muted/40"
            style={{ aspectRatio: `${caixa.largura} / ${caixa.altura}`, maxHeight: 180 }}
          >
            {monitores.map((m) => {
              const c = config[m.id];
              const nome = layouts.find((l) => l.id === c?.layoutId)?.nome;
              const aberta = c?.telaId ? telaEstaViva(c.telaId) : false;
              return (
                <div
                  key={m.id}
                  className={`absolute flex flex-col items-center justify-center gap-1 rounded-md border-2 p-2 text-center ${
                    nome ? "border-primary bg-primary/10" : "border-border bg-background"
                  }`}
                  style={{
                    left: `${((m.left - caixa.minX) / caixa.largura) * 100}%`,
                    top: `${((m.top - caixa.minY) / caixa.altura) * 100}%`,
                    width: `${(m.width / caixa.largura) * 100}%`,
                    height: `${(m.height / caixa.altura) * 100}%`,
                  }}
                >
                  <p className="truncate text-xs font-medium">
                    {m.numero ? `Monitor ${m.numero}` : m.rotulo}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {Math.round(m.width)}×{Math.round(m.height)}
                  </p>
                  {m.principal && (
                    <Badge variant="secondary" className="text-[10px]">
                      Principal
                    </Badge>
                  )}
                  {nome && <p className="truncate text-[11px] text-primary">{nome}</p>}
                  {aberta && <span className="text-[10px] text-emerald-600">no ar</span>}
                </div>
              );
            })}
          </div>
        )}

        {monitores.map((m) => {
          const c = config[m.id];
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3"
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium">
                  {m.numero ? `Monitor ${m.numero}` : m.rotulo}
                  {m.principal && (
                    <span className="ml-2 text-xs text-muted-foreground">principal</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{m.rotulo}</p>
              </div>
              <div className="w-full sm:w-72">
                <ComboSelect
                  value={c?.layoutId ?? ""}
                  onChange={(v) => atualizar(m.id, { layoutId: v })}
                  options={opcoes}
                  placeholder="Não abrir neste monitor"
                  searchPlaceholder="Pesquisar mosaico..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={c?.telaCheia !== false}
                  onCheckedChange={(v) => atualizar(m.id, { telaCheia: v })}
                />
                Tela cheia
              </label>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
