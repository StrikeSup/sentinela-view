import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, DoorClosed, DoorOpen, Eraser, Eye, EyeOff, FileText, Moon, Pencil, Save, Sun, Undo2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { textoIdade, type SeloPortao } from "@/lib/portao-status";
import { verificarLimiteDeteccao } from "@/lib/tipos-deteccao";
import { areaDosPontos, mascaraDaArea, pontosDaArea, type PontoPortao, type RoiPortao } from "@/lib/portao-area";
import { ALT_GRADES, LARG_GRADES } from "@/lib/portao-grades";
import { carregarVetor, vetorDe, type LeituraNavegador } from "@/lib/portao-navegador";
import { ancorar, medir, type AncoraV2 } from "@/lib/portao-v2/ritmo";
import { CONFIRMACAO_INICIAL_V2, alertaV2, confirmarV2, textoConfirmacaoV2, type ConfirmacaoV2, type DecisaoV2, type EstadoV2 } from "@/lib/portao-v2/fusao";
import { normalizarReferenciaV2, planoDeUso } from "@/lib/portao-v2/referencias";
import { anteriorDaFaixa, decidirComAnterior } from "@/lib/portao-v2/anterior";
import { montarDiagnosticoV2 } from "@/lib/portao-v2/diagnostico";
import type { SinaisV2 } from "@/lib/portao-v2/ritmo";
import { cn } from "@/lib/utils";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { type RegistroPortao } from "@/lib/portao-log";
import { cinza, clahe, movimentoPct, opcoesEfetivas, type OpcoesPortao } from "@/lib/portao-processamento";
import { barrasV2 as barrasDe } from "@/lib/portao-v2/tracado";

const PortaoLogJanela = lazy(() => import("./PortaoLogJanela").then((m) => ({ default: m.PortaoLogJanela })));

type Roi = RoiPortao;
type ConfigPortao = {
  ativo: boolean;
  roi: Roi | null;
  sensibilidade: number;
  tolerancia_segundos: number;
  referencias_fechado: string[];
  referencias_aberto: string[];
  modo_calibracao: string | null;
  referencias_fechado_noite: string[] | null;
  referencias_aberto_noite: string[] | null;
  opcoes_avancadas: Partial<OpcoesPortao> | null;
  estado: string | null;
  estado_em: string | null;
};
type TipoFoto = "fechado" | "aberto" | "fechadoNoite" | "abertoNoite";

const ROTULO_SELO: Record<SeloPortao, string> = {
  aberto: "Aberto",
  fechado: "Fechado",
  sem_leitura: "Sem leitura",
};
const CLASSE_SELO: Record<SeloPortao, string> = {
  aberto: "bg-destructive text-destructive-foreground",
  fechado: "bg-emerald-600 text-primary-foreground",
  sem_leitura: "bg-muted text-muted-foreground",
};

/** Selo do estado CONFIRMADO pelo teste ao vivo desta tela (o Agent ainda não roda o 2.0). */
function SeloStatus({ selo, idade, className = "" }: { selo: SeloPortao; idade: string | null; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow ${CLASSE_SELO[selo]} ${className}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-80" />
      {ROTULO_SELO[selo]}
      <span className="font-normal opacity-75">· Teste nesta tela{idade ? ` · ${idade}` : ""}</span>
    </span>
  );
}

const MAX_FOTOS = 5;

/** Calibração do portão: o operador marca o portão e tira fotos aberto/fechado; o Agent analisa. */
export function DeteccaoPortaoV2({
  cameraKey,
  dvrId,
  canal,
  clienteId,
  servidorId,
  podeEditar,
  seletor,
}: {
  cameraKey: string;
  dvrId: string;
  canal: number;
  clienteId: string | null;
  servidorId: string | null;
  podeEditar: boolean;
  seletor: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { isMaster } = useAuth();
  const [logAberto, setLogAberto] = useState(false);
  const [registros, setRegistros] = useState<RegistroPortao[]>([]);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const sequenciaLog = useRef(0);
  const fecharLog = useCallback(() => setLogAberto(false), []);
  useEffect(() => { setRegistros([]); setLogAberto(false); }, [cameraKey, isMaster]);
  // Fecha a foto ampliada com Esc.
  useEffect(() => {
    if (!fotoAmpliada) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setFotoAmpliada(null); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fotoAmpliada]);
  const quadroRef = useRef<HTMLDivElement>(null);

  const configQ = useQuery({
    queryKey: ["portao-v2-config", cameraKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras_portao_v2" as never)
        .select("ativo, roi, sensibilidade, tolerancia_segundos, referencias_fechado, referencias_aberto, modo_calibracao, referencias_fechado_noite, referencias_aberto_noite, opcoes_avancadas, estado, estado_em")
        .eq("dvr_id", dvrId)
        .eq("canal", canal)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ConfigPortao | null;
    },
    // Estado do portão ao vivo: acompanha a leitura do Agent enquanto a detecção estiver ligada.
    refetchInterval: (q) => (q.state.data?.ativo ? 3000 : false),
  });

  const [ativo, setAtivo] = useState(false);
  const [roi, setRoi] = useState<Roi | null>(null);
  const [rascunho, setRascunho] = useState<PontoPortao[] | null>(null);
  const arrastando = useRef<number | null>(null);
  const pontosArraste = useRef<PontoPortao[] | null>(null);
  const [sens, setSens] = useState(50);
  const [tolerancia, setTolerancia] = useState(60);
  const [fechadoDia, setFechado] = useState<string[]>([]);
  const [abertoDia, setAberto] = useState<string[]>([]);
  const [fechadoNoite, setFechadoNoite] = useState<string[]>([]);
  const [abertoNoite, setAbertoNoite] = useState<string[]>([]);
  const [avancado, setAvancado] = useState(false);
  /** Painel mostrado abaixo do vídeo: opções de processamento ou fotos de calibração. */
  const [painel, setPainel] = useState<"processamento" | "foto">("foto");
  const [verNormal, setVerNormal] = useState(false);
  const [opcoesSalvas, setOpcoesSalvas] = useState<Partial<OpcoesPortao>>({});
  const ops = useMemo(() => opcoesEfetivas(avancado, opcoesSalvas), [avancado, opcoesSalvas]);

  useEffect(() => {
    const c = configQ.data;
    setAtivo(c?.ativo ?? false);
    setRoi(c?.roi ?? null);
    setRascunho(null);
    setSens(c?.sensibilidade ?? 50);
    setTolerancia(c?.tolerancia_segundos ?? 60);
    setFechado(c?.referencias_fechado ?? []);
    setAberto(c?.referencias_aberto ?? []);
    setFechadoNoite(c?.referencias_fechado_noite ?? []);
    setAbertoNoite(c?.referencias_aberto_noite ?? []);
    setAvancado(c?.modo_calibracao === "avancado");
    setOpcoesSalvas(c?.opcoes_avancadas ?? {});
  }, [configQ.data]);

  // No modo avançado, a comparação usa as fotos de dia e de noite juntas.
  const fechado = useMemo(() => (avancado ? [...fechadoDia, ...fechadoNoite] : fechadoDia), [avancado, fechadoDia, fechadoNoite]);
  const aberto = useMemo(() => (avancado ? [...abertoDia, ...abertoNoite] : abertoDia), [avancado, abertoDia, abertoNoite]);
  const setters: Record<TipoFoto, React.Dispatch<React.SetStateAction<string[]>>> = {
    fechado: setFechado,
    aberto: setAberto,
    fechadoNoite: setFechadoNoite,
    abertoNoite: setAbertoNoite,
  };

  /* ---- relógio para o selo "há X s" ficar vivo ---- */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);


  /* ---- área do vídeo real dentro do quadro (vídeo contido) ---- */
  const areaVideo = () => {
    const caixa = quadroRef.current?.getBoundingClientRect();
    const video = quadroRef.current?.querySelector("video");
    if (!caixa) return null;
    if (!video || !video.videoWidth) return { left: caixa.left, top: caixa.top, w: caixa.width, h: caixa.height };
    const e = Math.min(caixa.width / video.videoWidth, caixa.height / video.videoHeight);
    const w = video.videoWidth * e;
    const h = video.videoHeight * e;
    return { left: caixa.left + (caixa.width - w) / 2, top: caixa.top + (caixa.height - h) / 2, w, h };
  };

  /* ---- contorno por pontos, normalizados ao vídeo ---- */
  const alterarArea = (nova: Roi | null) => {
    setRoi(nova);
    setLeituraNav(null);
    refsNav.current = { ancora: null, total: 0, vetores: [] };
  };
  const concluir = () => {
    if (!rascunho) return;
    const nova = areaDosPontos(rascunho);
    if (!nova) {
      toast.error("Marque ao menos três pontos, sem cruzar as linhas.");
      return;
    }
    alterarArea(nova);
    setRascunho(null);
  };
  const ponto = (ev: React.PointerEvent) => {
    const a = areaVideo();
    if (!a) return null;
    return {
      x: Math.min(1, Math.max(0, (ev.clientX - a.left) / a.w)),
      y: Math.min(1, Math.max(0, (ev.clientY - a.top) / a.h)),
    };
  };

  /* ---- capturar foto recortada na área ---- */
  const capturar = (): string | null => {
    const video = quadroRef.current?.querySelector("video");
    if (!video || video.readyState < 2 || !video.videoWidth) {
      toast.error("A imagem da câmera ainda não abriu.");
      return null;
    }
    if (!roi) {
      toast.error("Marque o portão na imagem antes de tirar a foto.");
      return null;
    }
    const sx = roi.x * video.videoWidth;
    const sy = roi.y * video.videoHeight;
    const sw = roi.w * video.videoWidth;
    const sh = roi.h * video.videoHeight;
    const escala = Math.min(1, 320 / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * escala));
    c.height = Math.max(1, Math.round(sh * escala));
    try {
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.8);
    } catch {
      toast.error("Não foi possível capturar a imagem.");
      return null;
    }
  };

  const adicionar = (tipo: TipoFoto) => {
    const foto = capturar();
    if (!foto) return;
    setters[tipo]((l) => [...l, foto].slice(-MAX_FOTOS));
  };

  const pronto = Boolean(roi) && fechado.length > 0 && aberto.length > 0;

  /* ---- leitura ao vivo pelo navegador (pipeline próprio do 2.0) ---- */
  const [leituraNav, setLeituraNav] = useState<LeituraNavegador | null>(null);
  const [decisaoNav, setDecisaoNav] = useState<DecisaoV2 | null>(null);
  const refsNav = useRef<{ ancora: AncoraV2 | null; total: number; vetores: Float32Array[] }>({ ancora: null, total: 0, vetores: [] });
  // Diagnóstico (Master): pedido atendido no próximo quadro processado, com o mesmo quadro do vídeo.
  const pedirDiagRef = useRef(false);
  const confRef = useRef<ConfirmacaoV2>(CONFIRMACAO_INICIAL_V2);
  const anteriorRef = useRef<Float32Array | null>(null);
  const [tempoNav, setTempoNav] = useState<{ status: EstadoV2; texto: string; tempo: number; alerta: boolean } | null>(null);
  const [etapasNav, setEtapasNav] = useState<string | null>(null);
  const [sinaisNav, setSinaisNav] = useState<SinaisV2 | null>(null);
  const [ultimaLeituraMs, setUltimaLeituraMs] = useState<number | null>(null);
  const [refsInfo, setRefsInfo] = useState<{ total: number; aceitas: number; rejeitadas: number; foraDeUso: number } | null>(null);
  const ultimaDecisaoRef = useRef<DecisaoV2 | null>(null);
  // Selo: estado confirmado do teste ao vivo; leitura com mais de 10 s vira "Sem leitura".
  const selo: SeloPortao = !tempoNav || ultimaLeituraMs === null || agora - ultimaLeituraMs > 10_000 || tempoNav.status === "incerto" ? "sem_leitura" : tempoNav.status;
  const idadeSelo = ultimaLeituraMs !== null && tempoNav ? textoIdade(Math.max(0, agora - ultimaLeituraMs)) : null;
  useEffect(() => {
    let vivo = true;
    refsNav.current = { ancora: null, total: 0, vetores: [] };
    const mascaraG = roi && ops.mascara ? mascaraDaArea(roi, LARG_GRADES, ALT_GRADES) : undefined;
    // Referências antigas (texto) entram como "legado" sem reescrita; inválidas são ignoradas.
    // Capturas desta tela já são recortadas na ROI; quadro completo (evento) não é usado sem recorte.
    const usaveis = fechado
      .map(normalizarReferenciaV2)
      .filter((r): r is NonNullable<typeof r> => !!r && planoDeUso(r, roi)?.recortar === false)
      .map((r) => r.src);
    setRefsInfo(null);
    Promise.all(usaveis.map((src) => carregarVetor(src, mascaraG, LARG_GRADES, ALT_GRADES, ops.clahe))).then((g) => {
      if (!vivo) return;
      const gs = g.filter((x): x is Float32Array => !!x);
      const ancora = ancorar(gs, LARG_GRADES, ALT_GRADES);
      refsNav.current = { ancora, total: gs.length, vetores: gs };
      const aceitas = ancora?.refs.length ?? 0;
      // rejeitadas: carregadas mas descartadas (sem grades ou passo destoante) ou que falharam ao abrir.
      setRefsInfo({ total: fechado.length, aceitas, rejeitadas: usaveis.length - aceitas, foraDeUso: fechado.length - usaveis.length });
    });
    return () => {
      vivo = false;
    };
  }, [fechado, roi, ops.mascara, ops.clahe]);
  useEffect(() => {
    confRef.current = CONFIRMACAO_INICIAL_V2;
    anteriorRef.current = null;
    ultimaDecisaoRef.current = null;
    if (!roi || rascunho !== null || !fechado.length || !aberto.length) {
      setLeituraNav(null);
      setDecisaoNav(null);
      setTempoNav(null);
      setEtapasNav(null);
      setSinaisNav(null);
      setUltimaLeituraMs(null);
      return;
    }
    const t = window.setInterval(() => {
      const video = quadroRef.current?.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const caixa = [roi.x * video.videoWidth, roi.y * video.videoHeight, roi.w * video.videoWidth, roi.h * video.videoHeight] as const;
      const vetG = vetorDe(video, ...caixa, ops.mascara ? mascaraDaArea(roi, LARG_GRADES, ALT_GRADES) : undefined, LARG_GRADES, ALT_GRADES, ops.clahe);
      if (!vetG) return;
      const agoraMs = Date.now();
      const { ancora } = refsNav.current;
      // Única decisão visual: nenhum classificador antigo sobrescreve.
      const sinais = ancora ? medir(vetG, ancora, LARG_GRADES, ALT_GRADES) : null;
      // Faixa intermediária mantém a ÚLTIMA ESTIMATIVA VISUAL válida (ver portao-v2/anterior.ts).
      const d: DecisaoV2 = sinais
        ? decidirComAnterior(sinais, sens, ultimaDecisaoRef.current)
        : { estado: "incerto", nota: 0, abertura: 0, confianca: 0, motivo: "Nenhuma foto Fechado com grades visíveis para aprender o passo das barras." };
      // Movimento: só informativo no 2.0 (nunca prova que está fechado).
      const mov = movimentoPct(vetG, anteriorRef.current);
      anteriorRef.current = vetG;
      const etapas: string[] = [];
      if (avancado) etapas.push(`Máscara ${ops.mascara ? "ligada" : "desligada"}`, `CLAHE ${ops.clahe ? "ligado" : "desligado"}`);
      etapas.push(`Movimento ${mov}% (informativo)`);
      const c = confirmarV2(confRef.current, d.estado, agoraMs);
      confRef.current = c;
      const al = alertaV2(c, agoraMs, tolerancia);
      const leitura: LeituraNavegador = { estado: d.estado, confianca: d.confianca, ...(ancora ? { aberturaPct: d.abertura } : {}) };
      setEtapasNav(etapas.join(" · "));
      setLeituraNav(leitura);
      setDecisaoNav(d);
      if (pedirDiagRef.current && isMaster) {
        pedirDiagRef.current = false;
        const png = (w: number, h: number) => {
          try {
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            const cx = cv.getContext("2d");
            if (!cx) return null;
            cx.drawImage(video, ...caixa, 0, 0, w, h);
            return cv.toDataURL("image/png");
          } catch { return null; }
        };
        const pacote = montarDiagnosticoV2({
          hora: agoraMs, larg: LARG_GRADES, alt: ALT_GRADES, video: { largura: video.videoWidth, altura: video.videoHeight }, caixa, roi,
          opcoes: { mascara: ops.mascara, clahe: ops.clahe, avancado }, sensibilidade: sens,
          pngReduzido: png(LARG_GRADES, ALT_GRADES), pngNativo: png(Math.max(1, Math.round(caixa[2])), Math.max(1, Math.round(caixa[3]))),
          vetor: vetG, referencias: refsNav.current.vetores, ancora, sinais, decisao: d,
          anterior: anteriorDaFaixa(ultimaDecisaoRef.current), confirmado: c.confirmado,
        });
        const url = URL.createObjectURL(new Blob([JSON.stringify(pacote)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url; a.download = `portao-v2-diagnostico-${new Date(agoraMs).toISOString().replace(/[:.]/g, "-")}.json`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast.success("Diagnóstico do quadro baixado");
      }
      ultimaDecisaoRef.current = d;
      setSinaisNav(sinais);
      setUltimaLeituraMs(agoraMs);
      setTempoNav({ status: c.confirmado, texto: textoConfirmacaoV2(c), tempo: al.tempoAbertoSegundos, alerta: al.alerta });
      if (isMaster) {
        const registro: RegistroPortao = {
          id: ++sequenciaLog.current, hora: agoraMs, leitura, status: c.confirmado,
          motivo: `[2.0] ${d.motivo}. Etapas: ${etapas.join(" · ")}.`, confirmacao: textoConfirmacaoV2(c), barras: null,
          sensibilidade: sens, tolerancia, tempo: al.tempoAbertoSegundos, alerta: al.alerta,
          referencias: `${refsNav.current.total} foto(s) Fechado usadas · passo ${ancora ? ancora.pitch.toFixed(1) : "—"} colunas`,
        };
        setRegistros((lista) => [...lista.slice(-119), registro]);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [roi, rascunho, sens, tolerancia, fechado.length, aberto.length, isMaster, avancado, ops]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (rascunho !== null) throw new Error("Conclua ou cancele o contorno antes de salvar.");
      if (ativo && !pronto)
        throw new Error("Para ativar, marque o portão e tire pelo menos uma foto aberto e uma fechado.");
      if (ativo) await verificarLimiteDeteccao(clienteId, "portao_v2", dvrId, canal);
      const { error } = await supabase.from("cameras_portao_v2" as never).upsert(
        {
          cliente_id: clienteId,
          servidor_id: servidorId,
          dvr_id: dvrId,
          canal,
          ativo,
          roi,
          sensibilidade: sens,
          tolerancia_segundos: tolerancia,
          referencias_fechado: fechadoDia,
          referencias_aberto: abertoDia,
          modo_calibracao: avancado ? "avancado" : "padrao",
          referencias_fechado_noite: fechadoNoite,
          referencias_aberto_noite: abertoNoite,
          opcoes_avancadas: opcoesEfetivas(true, opcoesSalvas),
          atualizado_em: new Date().toISOString(),
        } as never,
        { onConflict: "dvr_id,canal" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração do portão salva.");
      queryClient.invalidateQueries({ queryKey: ["portao-v2-config", cameraKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const Grupo = ({ lista, tipo, icone, titulo, botao }: { lista: string[]; tipo: TipoFoto; icone: ReactNode; titulo: string; botao: string }) => (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        {icone} {titulo} ({lista.length}/{MAX_FOTOS})
      </Label>
      <div className="flex flex-wrap gap-2">
        {lista.map((src, i) => (
          <div key={i} className="relative">
            <button
              type="button"
              title="Ampliar foto"
              aria-label={`Ampliar foto ${i + 1} do portão`}
              onClick={() => setFotoAmpliada(src)}
              className="block cursor-zoom-in"
            >
              <img src={src} alt={`Portão ${titulo}`} className="h-12 w-16 rounded border border-border object-cover" />
            </button>
            <button
              type="button"
              title="Excluir foto"
              aria-label={`Excluir foto ${i + 1}`}
              disabled={!podeEditar}
              onClick={() => setters[tipo]((l) => l.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {lista.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma foto.</span>}
      </div>
      <Button type="button" size="sm" variant="outline" disabled={!podeEditar || !roi || rascunho !== null} onClick={() => adicionar(tipo)}>
        <Camera className="mr-2 h-4 w-4" /> {botao}
      </Button>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card>
        <CardContent className="p-4">
          <div
            ref={quadroRef}
            className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-md bg-black"
            onPointerDown={(e) => {
              if (!podeEditar) return;
              const p = ponto(e);
              if (!p) return;
              if (rascunho !== null || !roi) {
                setRascunho((ps) => [...(ps ?? []), p]);
                return;
              }
              const pontos = pontosDaArea(roi);
              const area = areaVideo();
              if (!area) return;
              const i = pontos.findIndex((v) => Math.hypot((v.x - p.x) * area.w, (v.y - p.y) * area.h) <= 16);
              if (i < 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              arrastando.current = i;
              pontosArraste.current = pontos;
            }}
            onPointerMove={(e) => {
              const i = arrastando.current;
              const ps = pontosArraste.current;
              if (i === null || !ps) return;
              const p = ponto(e);
              if (!p) return;
              const novos = ps.map((v, j) => j === i ? p : v);
              if (!areaDosPontos(novos)) return;
              pontosArraste.current = novos;
              setRascunho(novos);
            }}
            onPointerUp={() => {
              if (arrastando.current === null) return;
              const ps = pontosArraste.current;
              const nova = ps ? areaDosPontos(ps) : null;
              if (nova && JSON.stringify(nova.pontos) !== JSON.stringify(roi ? pontosDaArea(roi) : [])) alterarArea(nova);
              arrastando.current = null;
              pontosArraste.current = null;
              setRascunho(null);
            }}
            onPointerCancel={() => {
              arrastando.current = null;
              pontosArraste.current = null;
              setRascunho(null);
            }}
          >
            <CameraAoVivo key={cameraKey} dvrId={dvrId} canal={canal} contido qualidade="extra" />
            {!verNormal && avancado && roi && rascunho === null && (ops.mascara || ops.clahe || ops.grades) && <PreviaProcessamento roi={roi} ops={ops} quadroRef={quadroRef} />}
            {!verNormal && (roi || rascunho?.length) && <RoiOverlay pontos={rascunho ?? (roi ? pontosDaArea(roi) : [])} fechado={rascunho === null} quadroRef={quadroRef} />}
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="pointer-events-auto h-8 w-8 bg-background/80 backdrop-blur"
                title={verNormal ? "Mostrar linhas de análise" : "Ver imagem normal (sem linhas)"}
                aria-label={verNormal ? "Mostrar linhas de análise" : "Ver imagem normal"}
                aria-pressed={verNormal}
                onClick={() => setVerNormal((v) => !v)}
              >
                {verNormal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <SeloStatus selo={selo} idade={idadeSelo} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {rascunho !== null ? <>
              <span className="text-xs text-muted-foreground">{rascunho.length} pontos</span>
              <Button type="button" size="sm" onClick={concluir} disabled={!podeEditar || rascunho.length < 3}><Check className="mr-1 h-4 w-4" /> Concluir contorno</Button>
              <Button type="button" size="icon" variant="outline" title="Desfazer último ponto" aria-label="Desfazer último ponto" disabled={!podeEditar || !rascunho.length} onClick={() => setRascunho((ps) => ps?.slice(0, -1) ?? [])}><Undo2 className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setRascunho(null)}>Cancelar</Button>
            </> : <>
              <Button type="button" size="sm" variant="outline" disabled={!podeEditar} onClick={() => setRascunho([])}><Pencil className="mr-1 h-4 w-4" /> {roi ? "Novo contorno" : "Marcar portão"}</Button>
              {roi && <>
                <Button type="button" size="sm" variant="outline" disabled={!podeEditar} onClick={() => { alterarArea(null); setRascunho(null); }}><Eraser className="mr-1 h-4 w-4" /> Limpar</Button>
                <span className="text-xs text-muted-foreground">Portão marcado · {roi.pontos ? `${roi.pontos.length} pontos` : "área retangular"}</span>
              </>}
              <div className="ml-auto grid max-w-[210px] grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {[{ v: "processamento" as const, t: "Processamento" }, { v: "foto" as const, t: "Foto" }].map((o) => (
                  <button
                    key={o.t}
                    type="button"
                    disabled={!podeEditar}
                    onClick={() => setPainel(o.v)}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium transition-colors",
                      painel === o.v ? "bg-background text-foreground shadow" : "text-muted-foreground",
                    )}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
              <div className="grid max-w-[190px] grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {[{ v: false, t: "Padrão" }, { v: true, t: "Avançada" }].map((o) => (
                  <button
                    key={o.t}
                    type="button"
                    disabled={!podeEditar}
                    onClick={() => setAvancado(o.v)}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium transition-colors",
                      avancado === o.v ? "bg-background text-foreground shadow" : "text-muted-foreground",
                    )}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
            </>}
          </div>
          {painel === "processamento" && !avancado && (
            <p className="mt-3 text-xs text-muted-foreground">As opções de processamento avançado aparecem no modo Avançada.</p>
          )}

          {avancado && painel === "processamento" && (
            <div className="mt-4 space-y-3 rounded-md border border-border p-3">
              <div>
                <Label>Processamento avançado</Label>
                <p className="text-xs text-muted-foreground">Ligue e desligue cada etapa: a imagem da câmera acima mostra na hora como a detecção passa a enxergar.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {OPCOES_UI.map((o) => (
                  <label key={o.chave} className="flex items-start justify-between gap-3 rounded-md bg-muted/50 p-2">
                    <span>
                      <span className="block text-sm font-medium">{o.titulo}</span>
                      <span className="block text-xs text-muted-foreground">{o.dica}</span>
                    </span>
                    <Switch checked={ops[o.chave]} disabled={!podeEditar} onCheckedChange={(v) => setOpcoesSalvas((s) => ({ ...s, [o.chave]: v }))} />
                  </label>
                ))}
              </div>
              {etapasNav && <p className="text-[11px] text-muted-foreground">Agora: {etapasNav}</p>}
            </div>
          )}


          {painel === "foto" && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <div className="space-y-2">
              <Label>Fotos de calibração</Label>
              {avancado && (
                <p className="text-xs text-muted-foreground">5 fotos de dia e 5 de noite, para aberto e fechado. Ajuda com chuva, faróis e escuridão.</p>
              )}
            </div>


            <div className="grid gap-4 sm:grid-cols-2">
              {avancado ? (
                <>
                  <Grupo tipo="fechado" lista={fechadoDia} icone={<><Sun className="h-4 w-4" /><DoorClosed className="h-4 w-4" /></>} titulo="Fechado de dia" botao="Foto fechado (dia)" />
                  <Grupo tipo="aberto" lista={abertoDia} icone={<><Sun className="h-4 w-4" /><DoorOpen className="h-4 w-4" /></>} titulo="Aberto de dia" botao="Foto aberto (dia)" />
                  <Grupo tipo="fechadoNoite" lista={fechadoNoite} icone={<><Moon className="h-4 w-4" /><DoorClosed className="h-4 w-4" /></>} titulo="Fechado de noite" botao="Foto fechado (noite)" />
                  <Grupo tipo="abertoNoite" lista={abertoNoite} icone={<><Moon className="h-4 w-4" /><DoorOpen className="h-4 w-4" /></>} titulo="Aberto de noite" botao="Foto aberto (noite)" />
                </>
              ) : (
                <>
                  <Grupo tipo="fechado" lista={fechadoDia} icone={<DoorClosed className="h-4 w-4" />} titulo="Fechado" botao="Foto do portão fechado" />
                  <Grupo tipo="aberto" lista={abertoDia} icone={<DoorOpen className="h-4 w-4" />} titulo="Aberto" botao="Foto do portão aberto" />
                </>
              )}
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-4">
          {seletor}
          <div className="flex items-center justify-between">
            <div>
              <Label>Portão aberto</Label>
              <p className="text-xs text-muted-foreground">Liga ou desliga esta câmera.</p>
            </div>
            <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!podeEditar} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Status do portão</Label>
              <p className="text-xs text-muted-foreground">Confirmado pelo teste nesta tela. O Agent ainda não roda o 2.0.</p>
            </div>
            <SeloStatus selo={selo} idade={idadeSelo} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Teste no navegador</Label>
              <p className="text-xs text-muted-foreground">Leitura ao vivo desta tela, a cada 1 s.</p>
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                !leituraNav || leituraNav.estado === "incerto"
                  ? "bg-muted text-muted-foreground"
                  : leituraNav.estado === "aberto"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground",
              )}
            >
              {!leituraNav
                ? pronto
                  ? "Aguardando imagem"
                  : "Falta área/fotos"
                : leituraNav.estado === "incerto"
                  ? "Estimativa: Incerto"
                  : `Estimativa: ${leituraNav.estado === "aberto" ? "Aberto" : "Fechado"}`}
            </span>
          </div>
          {decisaoNav && (
            <p className="-mt-3 text-[11px] text-muted-foreground">
              Nota técnica {Math.round(decisaoNav.nota * 100)}% · nível {decisaoNav.confianca}/100 (não é probabilidade)
              {leituraNav?.aberturaPct !== undefined && ` · abertura estimada ${leituraNav.aberturaPct}%`}
              <br />
              {decisaoNav.motivo}
            </p>
          )}
          {sinaisNav && (
            <div className="-mt-2 grid grid-cols-3 gap-x-2 gap-y-0.5 rounded-md border px-3 py-2 text-[11px] text-muted-foreground">
              {([
                ["Ritmo", sinaisNav.periodicidade], ["Bordas", sinaisNav.densidade], ["SSIM", sinaisNav.ssim],
                ["Energia", sinaisNav.energia], ["Cobertura", sinaisNav.cobertura], ["Continuidade", sinaisNav.continuidade],
                ["Espaçamento", sinaisNav.espacamento], ["Qualidade", sinaisNav.qualidade],
              ] as const).map(([nome, v]) => (
                <span key={nome}>{nome}: <b>{v === undefined ? "—" : `${Math.round(v * 100)}%`}</b></span>
              ))}
              <span>Passo: <b>{sinaisNav.pitch.toFixed(1)}</b></span>
            </div>
          )}
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Última leitura: <b>{ultimaLeituraMs ? new Date(ultimaLeituraMs).toLocaleTimeString("pt-BR") : "—"}</b>
            {" · "}Fotos Fechado: {refsInfo ? <><b>{refsInfo.aceitas}</b> aceita(s), <b>{refsInfo.rejeitadas}</b> rejeitada(s){refsInfo.foraDeUso ? `, ${refsInfo.foraDeUso} fora de uso (quadro completo/ inválida)` : ""}</> : "carregando…"}
          </p>
          {tempoNav && (
            <div className={cn("-mt-2 rounded-md border px-3 py-2 text-xs", tempoNav.alerta ? "border-destructive text-destructive" : "text-muted-foreground")}>
              Estado confirmado: <b>{tempoNav.status === "aberto" ? "Aberto" : tempoNav.status === "fechado" ? "Fechado" : "Incerto"}</b> · {tempoNav.texto}
              {tempoNav.status === "aberto" && ` · aberto há ${tempoNav.tempo} s (alerta aos ${tolerancia} s)`}
              {tempoNav.alerta && " · ALERTA"}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sensibilidade</Label>
              <span className="text-sm text-muted-foreground">{sens}%</span>
            </div>
            <Slider value={[sens]} onValueChange={(v) => setSens(v[0] ?? 50)} min={1} max={100} step={1} disabled={!podeEditar} />
          </div>

          <div className="space-y-1.5">
            <Label>Avisar se ficar aberto por (segundos)</Label>
            <Input
              type="number"
              min={0}
              max={3600}
              value={tolerancia}
              disabled={!podeEditar}
              onChange={(e) => setTolerancia(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
            />
          </div>

          <Button type="button" className="w-full" disabled={!podeEditar || salvar.isPending || rascunho !== null} onClick={() => salvar.mutate()}>
            <Save className="mr-2 h-4 w-4" /> Salvar configuração
          </Button>
          {isMaster && <Button type="button" variant="outline" className="w-full" onClick={() => setLogAberto(true)}><FileText className="mr-2 h-4 w-4" /> Log</Button>}
          {isMaster && <Button type="button" variant="outline" className="w-full" disabled={!sinaisNav} onClick={() => { pedirDiagRef.current = true; }}><FileText className="mr-2 h-4 w-4" /> Baixar diagnóstico do quadro</Button>}
        </CardContent>
      </Card>
      {isMaster && logAberto && <Suspense fallback={null}><PortaoLogJanela registros={registros} onFechar={fecharLog} onLimpar={() => setRegistros([])} /></Suspense>}
      {fotoAmpliada && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada do portão"
          onClick={() => setFotoAmpliada(null)}
        >
          <img src={fotoAmpliada} alt="Foto do portão ampliada" className="max-h-full max-w-full rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <Button
            type="button"
            size="icon"
            className="absolute right-3 top-3"
            title="Fechar (Esc)"
            aria-label="Fechar foto ampliada"
            onClick={() => setFotoAmpliada(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function RoiOverlay({ pontos, fechado, quadroRef }: { pontos: PontoPortao[]; fechado: boolean; quadroRef: React.RefObject<HTMLDivElement | null> }) {
  const [, forcar] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forcar((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const caixa = quadroRef.current?.getBoundingClientRect();
  const video = quadroRef.current?.querySelector("video");
  let ox = 0, oy = 0, w = caixa?.width ?? 0, h = caixa?.height ?? 0;
  if (caixa && video?.videoWidth) {
    const e = Math.min(caixa.width / video.videoWidth, caixa.height / video.videoHeight);
    w = video.videoWidth * e;
    h = video.videoHeight * e;
    ox = (caixa.width - w) / 2;
    oy = (caixa.height - h) / 2;
  }
  const vertices = pontos.map((p) => `${p.x * w},${p.y * h}`).join(" ");
  return (
    <svg className="pointer-events-none absolute overflow-visible text-primary" style={{ left: ox, top: oy, width: w, height: h }} viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`} aria-label="Contorno do portão">
      {fechado ? <polygon points={vertices} className="fill-primary/15 stroke-current" strokeWidth={2} /> : <polyline points={vertices} fill="none" className="stroke-current" strokeWidth={2} />}
      {pontos.map((p, i) => <circle key={i} cx={p.x * w} cy={p.y * h} r={6} className="fill-background stroke-current" strokeWidth={2} />)}
    </svg>
  );
}

const OPCOES_UI: { chave: keyof OpcoesPortao; titulo: string; dica: string }[] = [
  { chave: "mascara", titulo: "Máscara do contorno", dica: "Escurece tudo fora do portão: rua, carros e chão não contam." },
  { chave: "clahe", titulo: "Realce de contraste", dica: "Destaca as barras escuras à noite e na chuva." },
  { chave: "grades", titulo: "Grades verticais", dica: "Marca as barras encontradas e estima quanto abriu." },
  { chave: "ssim", titulo: "Comparar estrutura", dica: "Compara o formato das barras com as fotos, não o brilho." },
  { chave: "movimento", titulo: "Trava de movimento", dica: "Só muda o estado quando algo se mexe no portão (confere a cada 30 s)." },
];

/** Prévia ao vivo sobre a câmera: como a detecção enxerga com as etapas ligadas. */
function PreviaProcessamento({ roi, ops, quadroRef }: { roi: Roi; ops: OpcoesPortao; quadroRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const desenhar = () => {
      const c = canvasRef.current;
      const caixa = quadroRef.current?.getBoundingClientRect();
      const video = quadroRef.current?.querySelector("video");
      if (!c || !caixa || !video || video.readyState < 2 || !video.videoWidth) return;
      const e = Math.min(caixa.width / video.videoWidth, caixa.height / video.videoHeight);
      const w = Math.round(video.videoWidth * e), h = Math.round(video.videoHeight * e);
      c.style.left = `${(caixa.width - w) / 2}px`;
      c.style.top = `${(caixa.height - h) / 2}px`;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const pontos = pontosDaArea(roi);
      const caminho = () => {
        ctx.beginPath();
        pontos.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
        ctx.closePath();
      };
      const bx = roi.x * w, by = roi.y * h, bw = Math.max(1, roi.w * w), bh = Math.max(1, roi.h * h);
      const vx = roi.x * video.videoWidth, vy = roi.y * video.videoHeight, vw = roi.w * video.videoWidth, vh = roi.h * video.videoHeight;
      try {
        if (ops.clahe) {
          const lw = Math.max(8, Math.min(320, Math.round(bw))), lh = Math.max(8, Math.round((lw * bh) / bw));
          const off = document.createElement("canvas");
          off.width = lw; off.height = lh;
          const octx = off.getContext("2d", { willReadFrequently: true });
          if (octx) {
            octx.drawImage(video, vx, vy, vw, vh, 0, 0, lw, lh);
            const img = octx.getImageData(0, 0, lw, lh);
            const r = clahe(cinza(img.data), lw, lh, undefined, 8, 3);
            for (let i = 0; i < r.length; i++) { const v = r[i] ?? 0; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
            octx.putImageData(img, 0, 0);
            ctx.save();
            if (ops.mascara) { caminho(); ctx.clip(); }
            ctx.drawImage(off, bx, by, bw, bh);
            ctx.restore();
          }
        }
        if (ops.mascara) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          pontos.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
          ctx.closePath();
          ctx.fillStyle = "rgba(0,0,0,0.82)";
          ctx.fill("evenodd");
          ctx.restore();
        }
        if (ops.grades) {
          const vet = vetorDe(video, vx, vy, vw, vh, ops.mascara ? mascaraDaArea(roi, LARG_GRADES, ALT_GRADES) : undefined, LARG_GRADES, ALT_GRADES, ops.clahe);
          if (vet) {
            ctx.save();
            if (ops.mascara) { caminho(); ctx.clip(); }
            ctx.strokeStyle = getComputedStyle(c).color;
            ctx.lineWidth = 2;
            for (const b of barrasDe(vet)) {
              const x = bx + ((b + 0.5) / LARG_GRADES) * bw;
              ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + bh); ctx.stroke();
            }
            ctx.restore();
          }
        }
      } catch {
        /* imagem protegida: sem prévia */
      }
    };
    desenhar();
    const id = window.setInterval(desenhar, 300);
    return () => window.clearInterval(id);
  }, [roi, ops, quadroRef]);
  return <canvas ref={canvasRef} className="pointer-events-none absolute text-emerald-400" aria-label="Como a detecção enxerga" />;
}
