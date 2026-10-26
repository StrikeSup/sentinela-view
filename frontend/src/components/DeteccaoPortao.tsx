import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, DoorClosed, DoorOpen, Eraser, FileText, Moon, Pencil, Save, Sun, Undo2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { seloPortao, textoIdade, type SeloPortao } from "@/lib/portao-status";
import { verificarLimiteDeteccao } from "@/lib/tipos-deteccao";
import { areaDosPontos, mascaraDaArea, pontosDaArea, type PontoPortao, type RoiPortao } from "@/lib/portao-area";
import { ALT_GRADES, LARG_GRADES, TEMPO_INICIAL, avancarTempo, type AberturaGrades, type EstadoTempo } from "@/lib/portao-grades";
import { ALT, LARG, carregarVetor, classificar, vetorDe, type LeituraNavegador } from "@/lib/portao-navegador";
import { cn } from "@/lib/utils";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { confirmacaoPortao, motivoPortao, type RegistroPortao } from "@/lib/portao-log";
import { MOVIMENTO_LIMIAR_PCT, cinza, clahe, decidirSsim, movimentoPct, opcoesEfetivas, travarPorMovimento, type OpcoesPortao } from "@/lib/portao-processamento";
import { barras as barrasDe } from "@/lib/portao-grades";
import { aprenderReferencia, calibrar, decidirRitmo, sinaisRitmo, type Calibracao, type ReferenciaRitmo } from "@/lib/portao-periodicidade";

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

/** Selo "o que o sistema entendeu agora" — leitura do Agent, não cálculo do navegador. */
function SeloStatus({ selo, idade, className = "" }: { selo: SeloPortao; idade: string | null; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow ${CLASSE_SELO[selo]} ${className}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-80" />
      {ROTULO_SELO[selo]}
      {selo !== "sem_leitura" && idade && <span className="font-normal opacity-75">· {idade}</span>}
    </span>
  );
}

const MAX_FOTOS = 5;

/** Calibração do portão: o operador marca o portão e tira fotos aberto/fechado; o Agent analisa. */
export function DeteccaoPortao({
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
    queryKey: ["portao-config", cameraKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras_portao" as never)
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

  const selo = seloPortao(configQ.data?.estado, configQ.data?.estado_em, agora);
  const idadeSelo = (() => {
    const t = Date.parse(configQ.data?.estado_em ?? "");
    return Number.isFinite(t) ? textoIdade(agora - t) : null;
  })();

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
    refsNav.current = { f: [], a: [], g: [], ritmo: [], cal: null };
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

  /* ---- leitura ao vivo pelo navegador ---- */
  const [leituraNav, setLeituraNav] = useState<LeituraNavegador | null>(null);
  const refsNav = useRef<{ f: Float32Array[]; a: Float32Array[]; g: Float32Array[]; ritmo: ReferenciaRitmo[]; cal: Calibracao | null }>({ f: [], a: [], g: [], ritmo: [], cal: null });
  const tempoRef = useRef<EstadoTempo>(TEMPO_INICIAL);
  const anteriorRef = useRef<Float32Array | null>(null);
  const checagemRef = useRef(0);
  const [tempoNav, setTempoNav] = useState<{ status: string; abertura: number | null; tempo: number; alerta: boolean } | null>(null);
  const [etapasNav, setEtapasNav] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    refsNav.current = { f: [], a: [], g: [], ritmo: [], cal: null };
    const mascara = roi && ops.mascara ? mascaraDaArea(roi, LARG, ALT) : undefined;
    const mascaraG = roi && ops.mascara ? mascaraDaArea(roi, LARG_GRADES, ALT_GRADES) : undefined;
    Promise.all([
      Promise.all(fechado.map((src) => carregarVetor(src, mascara, LARG, ALT, ops.clahe))),
      Promise.all(aberto.map((src) => carregarVetor(src, mascara, LARG, ALT, ops.clahe))),
      Promise.all(fechado.map((src) => carregarVetor(src, mascaraG, LARG_GRADES, ALT_GRADES, ops.clahe))),
      Promise.all(aberto.map((src) => carregarVetor(src, mascaraG, LARG_GRADES, ALT_GRADES, ops.clahe))),
    ]).then(
      ([f, a, g, ga]) => {
        if (!vivo) return;
        const gs = g.filter((x): x is Float32Array => !!x);
        const ritmo = gs.map((v) => aprenderReferencia(v, LARG_GRADES, ALT_GRADES)).filter((r): r is ReferenciaRitmo => !!r);
        const cal = ritmo.length ? calibrar(ritmo, ga.filter((x): x is Float32Array => !!x), LARG_GRADES, ALT_GRADES) : null;
        refsNav.current = {
          f: f.filter((x): x is Float32Array => !!x),
          a: a.filter((x): x is Float32Array => !!x),
          g: gs,
          ritmo,
          cal,
        };
      },
    );
    return () => {
      vivo = false;
    };
  }, [fechado, aberto, roi, ops.mascara, ops.clahe]);
  useEffect(() => {
    tempoRef.current = TEMPO_INICIAL;
    anteriorRef.current = null;
    checagemRef.current = Date.now();
    if (!roi || rascunho !== null || !fechado.length || !aberto.length) {
      setLeituraNav(null);
      setTempoNav(null);
      setEtapasNav(null);
      return;
    }
    const t = window.setInterval(() => {
      const video = quadroRef.current?.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const caixa = [roi.x * video.videoWidth, roi.y * video.videoHeight, roi.w * video.videoWidth, roi.h * video.videoHeight] as const;
      const vet = vetorDe(video, ...caixa, ops.mascara ? mascaraDaArea(roi, LARG, ALT) : undefined, LARG, ALT, ops.clahe);
      if (!vet) return;
      const leitura = classificar(vet, refsNav.current.f, refsNav.current.a, sens);
      const etapas: string[] = [];
      if (avancado) etapas.push(`Máscara ${ops.mascara ? "ligada" : "desligada"}`, `CLAHE ${ops.clahe ? "ligado" : "desligado"}`);
      // SSIM: compara a estrutura com as fotos no lugar da diferença de pixels.
      if (ops.ssim) {
        const s = decidirSsim(vet, refsNav.current.f, refsNav.current.a, sens);
        etapas.push(`SSIM fechado ${s.ssimFechado} · aberto ${s.ssimAberto} → ${s.estado}`);
        leitura.estado = s.estado;
        leitura.confianca = Math.round(50 + Math.abs(s.ssimFechado - s.ssimAberto) * 50);
      }
      const base = { ...leitura };
      // Grades do portão vazado: estima a abertura (%) e manda na decisão quando a foto fechado tem grades.
      let ab: AberturaGrades | null = null;
      if (ops.grades) {
        // Ritmo das grades: periodicidade + bordas verticais + semelhança, pesos calibrados pelas fotos.
        const vetG = vetorDe(video, ...caixa, ops.mascara ? mascaraDaArea(roi, LARG_GRADES, ALT_GRADES) : undefined, LARG_GRADES, ALT_GRADES, ops.clahe);
        const { ritmo, cal } = refsNav.current;
        const sin = vetG && cal ? sinaisRitmo(vetG, ritmo, LARG_GRADES, ALT_GRADES, cal.pesos) : null;
        if (sin && cal) {
          const d = decidirRitmo(sin, cal.scoresAberto, sens);
          const esperadas = Math.round(LARG_GRADES / d.pitch);
          ab = {
            abertura: d.abertura, barrasFechado: esperadas, barrasAtual: Math.round(esperadas * (1 - d.abertura / 100)),
            ritmo: { estado: d.estado, score: d.score, periodicidade: d.periodicidade, densidade: d.densidade, ssim: d.ssim, limiarFechar: d.limiarFechar, limiarAbrir: d.limiarAbrir, pitch: d.pitch },
          };
          if (d.estado !== "incerto") { leitura.estado = d.estado; leitura.confianca = Math.round(60 + Math.min(1, Math.abs(d.score - (d.limiarFechar + d.limiarAbrir) / 2) * 2) * 40); }
          leitura.aberturaPct = d.abertura;
          if (avancado) etapas.push(`Nota ${Math.round(d.score * 100)}% (ritmo ${Math.round(d.periodicidade * 100)}%, bordas ${Math.round(d.densidade * 100)}%, semelhança ${Math.round(d.ssim * 100)}%)`);
        }
      } else if (avancado) etapas.push("Grades desligadas");
      // Trava de movimento: sem movimento na área, mantém o estado confirmado.
      const mov = movimentoPct(vet, anteriorRef.current);
      anteriorRef.current = vet;
      if (ops.movimento) {
        const tr = travarPorMovimento(leitura.estado, tempoRef.current.status, mov, Date.now() - checagemRef.current);
        if (!tr.travado && mov < MOVIMENTO_LIMIAR_PCT) checagemRef.current = Date.now();
        if (mov >= MOVIMENTO_LIMIAR_PCT) checagemRef.current = Date.now();
        etapas.push(`Movimento ${mov}%${tr.travado ? ` → travado em ${tempoRef.current.status}` : ""}`);
        leitura.estado = tr.estado;
      }
      setEtapasNav(etapas.length ? etapas.join(" · ") : null);
      setLeituraNav(leitura);
      const r = avancarTempo(tempoRef.current, leitura.estado, Date.now(), { confirmacoes: 2, alertarAposSegundos: tolerancia });
      tempoRef.current = r;
      setTempoNav({ status: r.status, abertura: ab?.abertura ?? null, tempo: r.tempoAbertoSegundos, alerta: r.alertaAtivo });
      if (isMaster) {
        const registro: RegistroPortao = {
          id: ++sequenciaLog.current, hora: Date.now(), leitura: { ...leitura }, status: r.status,
          motivo: motivoPortao(base, ab) + (etapas.length ? ` Etapas: ${etapas.join(" · ")}.` : ""), confirmacao: confirmacaoPortao(r), barras: ab,
          sensibilidade: sens, tolerancia, tempo: r.tempoAbertoSegundos, alerta: r.alertaAtivo,
          referencias: avancado ? `Dia ${fechadoDia.length} fechado/${abertoDia.length} aberto; noite ${fechadoNoite.length} fechado/${abertoNoite.length} aberto` : `Padrão: ${fechado.length} fechado/${aberto.length} aberto`,
        };
        setRegistros((lista) => [...lista.slice(-119), registro]);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [roi, rascunho, sens, tolerancia, fechado.length, aberto.length, isMaster, avancado, fechadoDia.length, abertoDia.length, fechadoNoite.length, abertoNoite.length, ops]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (rascunho !== null) throw new Error("Conclua ou cancele o contorno antes de salvar.");
      if (ativo && !pronto)
        throw new Error("Para ativar, marque o portão e tire pelo menos uma foto aberto e uma fechado.");
      if (ativo) await verificarLimiteDeteccao(clienteId, "portao", dvrId, canal);
      const { error } = await supabase.from("cameras_portao" as never).upsert(
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
      queryClient.invalidateQueries({ queryKey: ["portao-config", cameraKey] });
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
            {avancado && roi && rascunho === null && (ops.mascara || ops.clahe || ops.grades) && <PreviaProcessamento roi={roi} ops={ops} quadroRef={quadroRef} />}
            {(roi || rascunho?.length) && <RoiOverlay pontos={rascunho ?? (roi ? pontosDaArea(roi) : [])} fechado={rascunho === null} quadroRef={quadroRef} />}
            <div className="pointer-events-none absolute right-2 top-2 z-10">
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
              <p className="text-xs text-muted-foreground">O que o sistema entendeu agora.</p>
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
                  ? `Incerto (${leituraNav.confianca}%)`
                  : `${leituraNav.estado === "aberto" ? "Aberto" : "Fechado"} ${leituraNav.confianca}%`}
            </span>
          </div>
          {leituraNav && (leituraNav.distFechado !== undefined || leituraNav.gradesPct !== undefined) && (
            <p className="-mt-3 text-right text-[11px] text-muted-foreground">
              {leituraNav.gradesPct !== undefined && `Grades: ${leituraNav.gradesPct}% · `}
              Diferença p/ fechado {leituraNav.distFechado}% · p/ aberto {leituraNav.distAberto}%
            </p>
          )}
          {tempoNav && (
            <div className={cn("-mt-2 rounded-md border px-3 py-2 text-xs", tempoNav.alerta ? "border-destructive text-destructive" : "text-muted-foreground")}>
              Status confirmado (2 leituras): <b>{tempoNav.status === "aberto" ? "Aberto" : tempoNav.status === "fechado" ? "Fechado" : "Aguardando"}</b>
              {tempoNav.abertura !== null && ` · abertura estimada ${tempoNav.abertura}%`}
              {tempoNav.status === "aberto" && ` · aberto há ${tempoNav.tempo} s`}
              {tempoNav.alerta && ` · ALERTA (passou de ${tolerancia} s)`}
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
