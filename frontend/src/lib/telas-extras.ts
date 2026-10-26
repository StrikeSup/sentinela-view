import { supabase } from "@/integrations/supabase/client";
import { carimboDaJanela } from "@/lib/webrtc-sessions";


/**
 * Telas extras de Visualização abertas em janelas separadas (multi-monitor).
 * Guarda quantas janelas o usuário deixou abertas, com layout e posição,
 * para reabrir tudo no mesmo lugar no próximo acesso.
 */

export type TelaExtra = {
  id: string;
  layoutId: string | null;
  clienteId: string | null;
  left: number;
  top: number;
  width: number;
  height: number;
  /** monitor onde a tela foi deixada (quando o navegador permite reconhecer) */
  monitorId?: string | null;
  /**
   * monitor em que a janela realmente abriu agora. Difere de monitorId quando o
   * monitor original está desconectado: a tela abre em outro, mas a memória do
   * monitor de origem é preservada para quando ele voltar.
   */
  monitorAbertura?: string | null;
  /** reabrir ocupando o monitor inteiro */
  telaCheia?: boolean;
  /** usado apenas para escolher o registro mais recente ao eliminar duplicidades */
  atualizadoEm?: string;
};

/* ---------------------------------------------------------------
   Reconhecimento dos monitores (Window Management API).
   Precisa de permissão do usuário; sem ela, tudo continua
   funcionando apenas com a posição salva.
---------------------------------------------------------------- */

export type MonitorInfo = {
  /** número informado pela ordem atual do sistema operacional (somente exibição) */
  numero: number;
  /** assinatura do monitor (nome do sistema + resolução + principal) */
  id: string;
  /** identificação antiga, pela posição na área de trabalho */
  posicaoId: string;
  rotulo: string;
  left: number;
  top: number;
  width: number;
  height: number;
  principal: boolean;
};

type TelaDetalhada = {
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
  label?: string;
  devicePixelRatio?: number;
};

export function suportaMonitores() {
  return typeof window !== "undefined" && "getScreenDetails" in window;
}

/** Já autorizado antes? Evita pedir permissão sem o usuário clicar. */
export async function monitoresAutorizados() {
  if (!suportaMonitores()) return false;
  try {
    const p = await navigator.permissions.query({
      name: "window-management" as PermissionName,
    });
    return p.state === "granted";
  } catch {
    return false;
  }
}

type DetalhesTelas = {
  screens: TelaDetalhada[];
  addEventListener?: (tipo: string, ouvinte: () => void) => void;
  removeEventListener?: (tipo: string, ouvinte: () => void) => void;
};

let detalhes: DetalhesTelas | null = null;

async function obterDetalhes(recarregar = false): Promise<DetalhesTelas | null> {
  if (!suportaMonitores()) return null;
  if (recarregar) detalhes = null;
  detalhes ??= await (
    window as unknown as { getScreenDetails: () => Promise<DetalhesTelas> }
  ).getScreenDetails();
  return detalhes;
}

/**
 * Avisa quando um monitor é ligado, desligado ou muda de posição
 * (cabo HDMI, TV desligada, resolução alterada).
 */
export function ouvirMudancaDeMonitores(aoMudar: () => void) {
  if (typeof window === "undefined") return () => {};
  let atual: DetalhesTelas | null = null;
  const ouvinte = () => aoMudar();
  void (async () => {
    try {
      if (!(await monitoresAutorizados())) return;
      atual = await obterDetalhes();
      atual?.addEventListener?.("screenschange", ouvinte);
    } catch {
      /* sem suporte: o painel continua com a lista atual */
    }
  })();
  return () => {
    atual?.removeEventListener?.("screenschange", ouvinte);
  };
}

export async function listarMonitores(recarregar = false): Promise<MonitorInfo[]> {
  if (!suportaMonitores()) return [];
  try {
    const d = await obterDetalhes(recarregar);
    const lista = (d?.screens ?? []).map((s, i) => {

      const nome = s.label?.trim() || (s.isPrimary ? "Monitor principal" : `Monitor ${i + 1}`);
      const dpr = Math.round((s.devicePixelRatio ?? 1) * 100) / 100;
      const pos = `${Math.round(s.left)}:${Math.round(s.top)}`;
      return {
        numero: i + 1,
        // a assinatura inclui a ordem e a posição para diferenciar monitores/TVs
        // com o mesmo nome e a mesma resolução
        id: `m|${nome}|${Math.round(s.width)}x${Math.round(s.height)}@${dpr}|${s.isPrimary ? "P" : "S"}|#${i + 1}@${pos}`,
        posicaoId: pos,
        rotulo: nome,
        left: s.left,
        top: s.top,
        width: s.width,
        height: s.height,
        principal: s.isPrimary,
      };
    });
    guardarCacheMonitores(lista);
    difundirMonitores(lista);
    return lista;
  } catch {
    return [];
  }
}

const CHAVE_CACHE_MONITORES = "sentinela:monitores-conhecidos";
const CANAL_MONITORES = "sentinela:monitores";

/**
 * Guarda a última lista detectada para usar quando a permissão não responder.
 * `aoVivo` indica detecção real do navegador: só ela pode substituir uma lista
 * maior já conhecida (uma janela extra nunca rebaixa 7 monitores para 1).
 */
function guardarCacheMonitores(lista: MonitorInfo[], aoVivo = true) {
  if (!lista.length || typeof localStorage === "undefined") return;
  if (!aoVivo && lista.length < cacheMonitores().length) return;
  try {
    localStorage.setItem(CHAVE_CACHE_MONITORES, JSON.stringify(lista));
  } catch {
    /* armazenamento cheio ou bloqueado */
  }
}

function cacheMonitores(): MonitorInfo[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE_MONITORES);
    const lista = bruto ? (JSON.parse(bruto) as MonitorInfo[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

let canalMonitores: BroadcastChannel | null = null;

function obterCanalMonitores(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!canalMonitores) {
    try {
      canalMonitores = new BroadcastChannel(CANAL_MONITORES);
      canalMonitores.onmessage = (ev) => {
        const lista = (ev.data as { monitores?: MonitorInfo[] })?.monitores;
        if (Array.isArray(lista) && lista.length) guardarCacheMonitores(lista, false);
      };
    } catch {
      return null;
    }
  }
  return canalMonitores;
}

/** Avisa as outras janelas deste navegador sobre a lista recém-detectada. */
function difundirMonitores(lista: MonitorInfo[]) {
  if (!lista.length) return;
  try {
    obterCanalMonitores()?.postMessage({ monitores: lista });
  } catch {
    /* outra janela pode ter fechado o canal */
  }
}

/**
 * Se o navegador já autorizou, detecta os monitores uma vez e compartilha a
 * lista com as demais janelas (inclusive as telas extras).
 */
export async function garantirMonitoresDetectados(): Promise<MonitorInfo[]> {
  obterCanalMonitores();
  try {
    if (!(await monitoresAutorizados())) return cacheMonitores();
    const lista = await listarMonitores(true);
    if (lista.length) difundirMonitores(lista);
    return lista.length ? lista : cacheMonitores();
  } catch {
    return cacheMonitores();
  }
}

/**
 * Monitores que conhecemos deste computador: lista ao vivo quando há permissão,
 * senão a última lista detectada (inclusive a recebida de outra janela) e, em
 * último caso, a tela atual.
 */
export async function monitoresConhecidos(): Promise<MonitorInfo[]> {
  obterCanalMonitores();
  if (await monitoresAutorizados()) {
    const lista = await listarMonitores();
    if (lista.length) {
      difundirMonitores(lista);
      return lista;
    }
  }
  const guardados = cacheMonitores();
  if (guardados.length) return guardados;
  return monitorDaTelaAtual();
}

function htmlIdentificacaoMonitor(numero: number, total: number) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Monitor ${numero}</title>
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}
    body{display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif}
    main{text-align:center}strong{display:block;font-size:min(42vw,160px);line-height:.85}
    span{display:block;margin-top:20px;font-size:22px;font-weight:600}
    small{display:block;margin-top:8px;color:#94a3b8;font-size:14px}
  </style>
</head>
<body>
  <main><strong>${numero}</strong><span>Monitor ${numero}</span><small>${total} monitor${total === 1 ? "" : "es"} detectado${total === 1 ? "" : "s"}</small></main>
  <script>setTimeout(function(){window.close()},6000)<\/script>
</body>
</html>`;
}

/**
 * Abre a mesma identificação temporária no centro de cada monitor conhecido.
 * Deve ser chamada diretamente por um clique sempre que possível, pois alguns
 * navegadores bloqueiam pop-ups iniciados por comandos remotos.
 */
export function abrirIdentificacoesMonitores(monitores: MonitorInfo[]) {
  let abertas = 0;
  const comando = Date.now();
  for (const monitor of monitores) {
    const largura = Math.min(420, Math.max(280, Math.round(monitor.width * 0.3)));
    const altura = Math.min(300, Math.max(220, Math.round(monitor.height * 0.28)));
    const left = Math.round(monitor.left + (monitor.width - largura) / 2);
    const top = Math.round(monitor.top + (monitor.height - altura) / 2);
    const janela = window.open(
      "",
      `sentinela-identificar-${monitor.numero}-${comando}`,
      `popup=yes,left=${left},top=${top},width=${largura},height=${altura}`,
    );
    if (!janela) continue;
    janela.document.open();
    janela.document.write(htmlIdentificacaoMonitor(monitor.numero || 1, monitores.length));
    janela.document.close();
    try {
      janela.moveTo(left, top);
      janela.resizeTo(largura, altura);
      janela.focus();
    } catch {
      /* o navegador pode impedir o reposicionamento */
    }
    abertas += 1;
  }
  return { abertas, bloqueadas: Math.max(0, monitores.length - abertas) };
}

/** Monitor único montado a partir da tela atual, quando nada é conhecido. */
function monitorDaTelaAtual(): MonitorInfo[] {
  if (typeof window === "undefined" || !window.screen) return [];
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return [
    {
      numero: 1,
      id: `m|Este monitor|${Math.round(s.width)}x${Math.round(s.height)}@1|P|#1@0:0`,
      posicaoId: "0:0",
      rotulo: "Este monitor",
      left: s.availLeft ?? 0,
      top: s.availTop ?? 0,
      width: s.width,
      height: s.height,
      principal: true,
    },
  ];
}



/** Extrai ordem (#n) e posição (left:top) da assinatura, quando existirem. */
function detalheDaAssinatura(monitorId: string) {
  const parte = monitorId.split("|")[4];
  if (!parte) return { numero: 0, posicaoId: "" };
  const [n, pos] = parte.split("@");
  return { numero: Number(n?.replace("#", "")) || 0, posicaoId: pos ?? "" };
}

/**
 * Reconhece o monitor guardado mesmo que a ordem, o nome ou a resolução tenham
 * mudado. A identidade vale mais que o nome: assinatura exata → posição na área
 * de trabalho → ordem do sistema → nome + resolução.
 * O nome (rótulo EDID) muda sozinho com troca de cabo, driver ou TV, então só é
 * usado como último recurso.
 */
export function encontrarMonitor(
  monitores: MonitorInfo[],
  monitorId: string | null | undefined,
  usados?: Set<string>,
): MonitorInfo | null {
  if (!monitorId) return null;
  const livre = (m: MonitorInfo) => !usados || !usados.has(m.id);
  const preferirLivre = (cands: MonitorInfo[]) => {
    const disponiveis = cands.filter(livre);
    return (disponiveis.length ? disponiveis : cands)[0] ?? null;
  };
  const exato = monitores.find((m) => m.id === monitorId);
  if (exato) return exato;
  if (monitorId.startsWith("m|")) {
    const [, nome, medida] = monitorId.split("|");
    const { numero, posicaoId } = detalheDaAssinatura(monitorId);
    // 1) mesma posição na área de trabalho — identidade mais estável
    const porPosicao = posicaoId
      ? preferirLivre(monitores.filter((m) => m.posicaoId === posicaoId))
      : null;
    if (porPosicao) return porPosicao;
    // 2) mesma ordem de enumeração do sistema
    const porOrdem = numero ? preferirLivre(monitores.filter((m) => m.numero === numero)) : null;
    if (porOrdem) return porOrdem;
    // 3) só então o nome (com a mesma medida, depois sem ela)
    const porNome = preferirLivre(
      monitores.filter((m) => m.rotulo === nome && m.id.includes(`|${medida}|`)),
    );
    if (porNome) return porNome;
    return preferirLivre(monitores.filter((m) => m.rotulo === nome));
  }
  // identificação antiga, guardada pela posição na área de trabalho
  return monitores.find((m) => m.posicaoId === monitorId) ?? null;
}


/**
 * Reconhecimento aproximado do monitor sem a permissão de monitores do
 * navegador: usa as medidas da tela em que a janela está (window.screen).
 * Retorna a posição/assinatura mas **sem número de monitor** — o navegador
 * não expõe o número real do Windows, então não chutamos um número falso.
 * O número só aparece depois que o usuário autoriza a lista de monitores.
 */
export function monitorAproximado(): MonitorInfo | null {
  if (typeof window === "undefined" || !window.screen) return null;
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  const left = Math.round(s.availLeft ?? 0);
  const top = Math.round(s.availTop ?? 0);
  const width = Math.round(s.width);
  const height = Math.round(s.height);
  const principal = left === 0 && top === 0;
  const nome = principal ? "Monitor principal" : "Monitor secundário";
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  return {
    numero: 0,
    id: `m|${nome}|${width}x${height}@${dpr}|${principal ? "P" : "S"}|#0@${left}:${top}`,
    posicaoId: `${left}:${top}`,
    rotulo: nome,
    left,
    top,
    width,
    height,
    principal,
  };
}

export function monitorDaPosicao(
  monitores: MonitorInfo[],
  left: number,
  top: number,
  width = 0,
  height = 0,
): MonitorInfo | null {
  const cx = left + width / 2;
  const cy = top + height / 2;
  return (
    monitores.find(
      (m) => cx >= m.left && cx < m.left + m.width && cy >= m.top && cy < m.top + m.height,
    ) ?? null
  );
}

/** Reposiciona a tela dentro do monitor guardado, caso ele tenha mudado de lugar. */
export function ajustarAoMonitor(tela: TelaExtra, monitores: MonitorInfo[]): TelaExtra {
  if (!tela.monitorId || !monitores.length) return tela;
  const alvo = encontrarMonitor(monitores, tela.monitorId);
  if (!alvo) return tela;
  const dentro = monitorDaPosicao(monitores, tela.left, tela.top, tela.width, tela.height);
  if (dentro?.id === alvo.id) return tela;
  return {
    ...tela,
    left: alvo.left + Math.max(0, Math.round((alvo.width - tela.width) / 2)),
    top: alvo.top + Math.max(0, Math.round((alvo.height - tela.height) / 2)),
  };
}

const CHAVE = "sentinela:telas-extras";
const CHAVE_TELA_CONFIG = "sentinela:tela-config:";
const CHAVE_TELA_VIVA = "sentinela:tela-viva:";
// Abas em segundo plano podem ter seus temporizadores reduzidos pelo navegador.
// A janela avisa explicitamente quando fecha; este limite maior evita falsos
// desaparecimentos quando o navegador apenas suspendeu o JavaScript por instantes.
const LIMITE_TELA_VIVA_MS = 90_000;
const CANAL_TELAS = "sentinela:telas-ciclo";
const CHAVE_FECHAMENTO_TELA = "sentinela:tela-fechada";
const CHAVE_FECHAMENTO_COLETIVO = "sentinela:fechamento-coletivo";
const LIMITE_FECHAMENTO_COLETIVO_MS = 15_000;

export function lerTelas(): TelaExtra[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAVE);
    const arr = raw ? (JSON.parse(raw) as TelaExtra[]) : [];
    const porId = new Map<string, TelaExtra>();
    if (Array.isArray(arr)) {
      for (const tela of arr) {
        if (tela && typeof tela.id === "string") porId.set(tela.id, tela);
      }
    }
    // Cada janela também possui uma cópia independente. Assim duas telas que
    // salvam ao mesmo tempo nunca apagam uma à outra da lista compartilhada.
    for (let i = 0; i < window.localStorage.length; i++) {
      const chave = window.localStorage.key(i);
      if (!chave?.startsWith(CHAVE_TELA_CONFIG)) continue;
      try {
        const tela = JSON.parse(window.localStorage.getItem(chave) ?? "null") as TelaExtra | null;
        if (tela && typeof tela.id === "string") porId.set(tela.id, tela);
      } catch {
        /* ignora apenas este registro inválido */
      }
    }
    return Array.from(porId.values());
  } catch {
    return [];
  }
}

export function gravarTelas(lista: TelaExtra[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAVE, JSON.stringify(lista));
}

export function salvarTela(tela: TelaExtra) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${CHAVE_TELA_CONFIG}${tela.id}`, JSON.stringify(tela));
  } catch {
    /* a lista compartilhada ainda será tentada abaixo */
  }
  const lista = lerTelas();
  const i = lista.findIndex((t) => t.id === tela.id);
  if (i >= 0) lista[i] = tela;
  else lista.push(tela);
  gravarTelas(lista);
}

export function removerTela(id: string) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(`${CHAVE_TELA_CONFIG}${id}`);
      window.localStorage.removeItem(`${CHAVE_TELA_VIVA}${id}`);
      window.localStorage.removeItem(`sentinela:tela-reservada:${id}`);
    } catch {
      /* ignora */
    }
  }
  gravarTelas(lerTelas().filter((t) => t.id !== id));
}

const CHAVE_LAYOUT_CACHE = "sentinela:layout-cache:";

/** Guarda o mosaico para a tela extra desenhar a grade assim que abrir. */
export function guardarLayoutCache(id: string, layout: unknown) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.localStorage.setItem(`${CHAVE_LAYOUT_CACHE}${id}`, JSON.stringify(layout));
  } catch {
    /* espaço cheio: segue sem cache */
  }
}

export function lerLayoutCache<T>(id: string | null | undefined): T | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const raw = window.localStorage.getItem(`${CHAVE_LAYOUT_CACHE}${id}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Tela extra: publica um sinal periódico que continua detectável mesmo quando
 * a tela principal foi recarregada e perdeu a referência de window.open().
 */
export function registrarTelaViva(id: string, obterTela?: () => TelaExtra | null) {
  if (typeof window === "undefined") return () => {};
  const chave = `${CHAVE_TELA_VIVA}${id}`;
  const publicar = () => {
    try {
      const tela = obterTela?.() ?? null;
      if (tela) salvarTela(tela);
      const sinal = { em: Date.now(), layoutId: tela?.layoutId ?? null, tela };
      window.localStorage.setItem(
        chave,
        JSON.stringify(sinal),
      );
      const bc = new BroadcastChannel(CANAL_TELAS);
      bc.postMessage({ tipo: "viva", id, sinal });
      bc.close();
    } catch {
      /* ignora */
    }
  };
  const remover = () => {
    try {
      window.localStorage.removeItem(chave);
    } catch {
      /* ignora */
    }
  };
  const avisarFechamento = () => {
    remover();
    try {
      const coletivo = Number(window.localStorage.getItem(CHAVE_FECHAMENTO_COLETIVO));
      if (Number.isFinite(coletivo) && Date.now() - coletivo <= LIMITE_FECHAMENTO_COLETIVO_MS) return;
      const mensagem = JSON.stringify({ id, em: Date.now() });
      const bc = new BroadcastChannel(CANAL_TELAS);
      bc.postMessage({ tipo: "fechada", id });
      bc.close();
      window.localStorage.setItem(CHAVE_FECHAMENTO_TELA, mensagem);
    } catch {
      /* a memória será mantida se não houver uma janela principal para confirmar */
    }
  };
  publicar();
  const intervalo = window.setInterval(publicar, 2000);
  const aoFocar = () => publicar();
  const aoMudarVisibilidade = () => publicar();
  window.addEventListener("focus", aoFocar);
  window.addEventListener("pageshow", aoFocar);
  window.addEventListener("online", aoFocar);
  window.addEventListener("resize", aoFocar);
  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("pagehide", avisarFechamento);
  return () => {
    window.clearInterval(intervalo);
    window.removeEventListener("focus", aoFocar);
    window.removeEventListener("pageshow", aoFocar);
    window.removeEventListener("online", aoFocar);
    window.removeEventListener("resize", aoFocar);
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    window.removeEventListener("pagehide", avisarFechamento);
    avisarFechamento();
  };
}

/**
 * A janela principal confirma o fechamento após o tempo do sinal de presença.
 * Um simples recarregamento volta a publicar presença e, portanto, não apaga a tela.
 */
export function ouvirFechamentoDeTela(aoFechar: (id: string) => void) {
  if (typeof window === "undefined") return () => {};
  const pendentes = new Map<string, number>();
  const conferir = (id: string) => {
    const anterior = pendentes.get(id);
    if (anterior) window.clearTimeout(anterior);
    const timer = window.setTimeout(() => {
      pendentes.delete(id);
      if (!telaEstaViva(id)) aoFechar(id);
    }, LIMITE_TELA_VIVA_MS + 1000);
    pendentes.set(id, timer);
  };
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CANAL_TELAS);
    bc.onmessage = (e) => {
      const id = e.data?.tipo === "fechada" ? String(e.data.id ?? "") : "";
      if (id) conferir(id);
    };
  } catch {
    bc = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CHAVE_FECHAMENTO_TELA || !e.newValue) return;
    try {
      const id = String((JSON.parse(e.newValue) as { id?: unknown }).id ?? "");
      if (id) conferir(id);
    } catch {
      /* ignora mensagem inválida */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bc?.close();
    window.removeEventListener("storage", onStorage);
    for (const timer of pendentes.values()) window.clearTimeout(timer);
    pendentes.clear();
  };
}

function sinalDaTela(id: string): { em: number; layoutId: string | null; tela: TelaExtra | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${CHAVE_TELA_VIVA}${id}`);
    if (!raw) return null;
    // formato antigo: apenas o carimbo de tempo
    if (!raw.startsWith("{")) {
      const em = Number(raw);
      return Number.isFinite(em) ? { em, layoutId: null, tela: null } : null;
    }
    const dados = JSON.parse(raw) as { em?: number; layoutId?: string | null; tela?: TelaExtra | null };
    return Number.isFinite(dados.em)
      ? { em: Number(dados.em), layoutId: dados.layoutId ?? null, tela: dados.tela ?? null }
      : null;
  } catch {
    return null;
  }
}

/** Registros completos publicados pelas janelas que continuam abertas. */
export function lerTelasVivas(): TelaExtra[] {
  if (typeof window === "undefined") return [];
  const vivas: TelaExtra[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const chave = window.localStorage.key(i);
    if (!chave?.startsWith(CHAVE_TELA_VIVA)) continue;
    const id = chave.slice(CHAVE_TELA_VIVA.length);
    const sinal = sinalDaTela(id);
    if (sinal?.tela && Date.now() - sinal.em <= LIMITE_TELA_VIVA_MS) vivas.push(sinal.tela);
  }
  return vivas;
}

/** Atualiza o painel imediatamente quando uma tela publica presença. */
export function ouvirPresencaTelas(atualizar: () => void) {
  if (typeof window === "undefined") return () => {};
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CANAL_TELAS);
    bc.onmessage = (e) => {
      if (e.data?.tipo === "viva") atualizar();
    };
  } catch {
    bc = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(CHAVE_TELA_VIVA)) atualizar();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bc?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Janela recém-aberta que ainda não teve tempo de publicar presença.
 * Sem isso, dois cliques seguidos em "Nova tela" usavam o mesmo identificador
 * e o navegador recarregava a janela anterior em vez de abrir outra.
 */
const CHAVE_TELA_RESERVADA = "sentinela:tela-reservada:";
const LIMITE_RESERVA_MS = 30_000;

export function reservarIdTela(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${CHAVE_TELA_RESERVADA}${id}`, String(Date.now()));
  } catch {
    /* ignora */
  }
}

function telaReservada(id: string) {
  if (typeof window === "undefined") return false;
  try {
    const em = Number(window.localStorage.getItem(`${CHAVE_TELA_RESERVADA}${id}`)) || 0;
    if (!em) return false;
    if (Date.now() - em <= LIMITE_RESERVA_MS) return true;
    window.localStorage.removeItem(`${CHAVE_TELA_RESERVADA}${id}`);
    return false;
  } catch {
    return false;
  }
}

/** Janela viva por referência direta ou pelo sinal da própria tela extra. */
export function telaEstaViva(id: string) {
  const janela = janelaDaTela(id);
  if (janela) return true;
  if (telaReservada(id)) return true;
  const sinal = sinalDaTela(id);
  return !!sinal && Date.now() - sinal.em <= LIMITE_TELA_VIVA_MS;
}

/**
 * Presença recente: a tela extra publica sinal a cada 2s. Para o painel
 * "Telas abertas", usar um limite curto faz a tela sumir logo que a janela é
 * fechada, mesmo quando o navegador não conseguiu avisar o fechamento.
 * A memória de reabertura continua intacta.
 */
const LIMITE_TELA_ATIVA_MS = 12_000;

export function telaRespondendo(id: string) {
  const janela = janelaDaTela(id);
  if (janela) return true;
  if (telaReservada(id)) return true;
  const sinal = sinalDaTela(id);
  return !!sinal && Date.now() - sinal.em <= LIMITE_TELA_ATIVA_MS;
}

/** Mosaico que a própria tela extra está exibindo agora. */
export function layoutDaTelaViva(id: string): string | null {
  const sinal = sinalDaTela(id);
  if (!sinal || Date.now() - sinal.em > LIMITE_TELA_VIVA_MS) return null;
  return sinal.layoutId;
}

/** Parâmetros da janela extra, quando a página está rodando dentro de uma delas */
export function paramsDaTela(): {
  id: string;
  layoutId: string | null;
  clienteId: string | null;
  telaCheia: boolean;
  monitorId: string | null;
  monitorAbertura: string | null;
} | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const id = p.get("tela");
  if (!id) return null;
  return {
    id,
    layoutId: p.get("layout"),
    clienteId: p.get("cliente"),
    telaCheia: p.get("cheia") === "1",
    monitorId: p.get("mon"),
    monitorAbertura: p.get("ini"),
  };
}

/**
 * Tela extra: leva a própria janela para o monitor guardado.
 * O navegador quase sempre abre a janela no mesmo monitor de quem a abriu e
 * só aceita a mudança depois que a página carrega — por isso são feitas
 * várias tentativas curtas até a janela chegar ao monitor certo.
 */
export async function posicionarNoMonitor(): Promise<MonitorInfo | null> {
  if (typeof window === "undefined") return null;
  const params = paramsDaTela();
  if (!params) return null;
  if (!(await monitoresAutorizados())) return null;
  const monitores = await listarMonitores();
  if (!monitores.length) return null;
  const alvo =
    encontrarMonitor(monitores, params.monitorAbertura) ??
    encontrarMonitor(monitores, params.monitorId);
  if (!alvo) return null;

  const chegou = () => {
    const atual = monitorDaPosicao(
      monitores,
      window.screenX,
      window.screenY,
      window.outerWidth,
      window.outerHeight,
    );
    return atual?.id === alvo.id;
  };
  const mover = () => {
    try {
      window.moveTo(Math.round(alvo.left), Math.round(alvo.top));
      window.resizeTo(Math.round(alvo.width), Math.round(alvo.height));
    } catch {
      /* alguns navegadores não deixam mover a janela */
    }
  };
  for (const espera of [0, 300, 800, 1500, 3000]) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    if (chegou()) break;
    mover();
  }
  return alvo;
}

/** Objeto do monitor devolvido pelo navegador (necessário para a tela cheia). */
function telaDoMonitor(monitor: MonitorInfo | null): TelaDetalhada | null {
  if (!monitor || !detalhes) return null;
  return (
    detalhes.screens.find(
      (s) => Math.round(s.left) === Math.round(monitor.left) && Math.round(s.top) === Math.round(monitor.top),
    ) ?? null
  );
}

/** Tela extra: entra em tela cheia (tenta sozinha e, se preciso, no 1º clique). */
export function entrarEmTelaCheia(monitor?: MonitorInfo | null): () => void {
  if (typeof document === "undefined") return () => {};
  const tela = telaDoMonitor(monitor ?? null);
  const pedir = () => {
    if (document.fullscreenElement) return;
    const opcoes = tela ? ({ screen: tela } as FullscreenOptions) : undefined;
    void document.documentElement
      .requestFullscreen?.(opcoes)
      .catch(() => void document.documentElement.requestFullscreen?.().catch(() => {}));
  };
  // algumas janelas só aceitam o pedido depois de carregar/receber o foco:
  // tenta algumas vezes sozinha antes de depender de um clique.
  const tempos = [0, 400, 1200, 2500, 5000].map((ms) => window.setTimeout(pedir, ms));
  const noGesto = () => {
    pedir();
    remover();
  };
  const remover = () => {
    tempos.forEach((t) => window.clearTimeout(t));
    window.removeEventListener("pointerdown", noGesto);
    window.removeEventListener("keydown", noGesto);
    window.removeEventListener("focus", pedir);
  };
  window.addEventListener("pointerdown", noGesto);
  window.addEventListener("keydown", noGesto);
  window.addEventListener("focus", pedir);
  return remover;
}


export const emTelaExtra = () => paramsDaTela() !== null;

/**
 * Memória da própria janela: guarda qual tela extra ela é, para continuar
 * sendo uma tela separada mesmo que o endereço perca os parâmetros
 * (troca de página pelo menu, recarga, sessão restaurada pelo navegador).
 */
const CHAVE_TELA_JANELA = "sentinela_tela_da_janela";

export function lembrarTelaDaJanela(id: string) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.sessionStorage.setItem(
      CHAVE_TELA_JANELA,
      JSON.stringify({ id, carimbo: carimboDaJanela() }),
    );
  } catch {
    /* ignora */
  }
}

export function telaLembradaDaJanela(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_TELA_JANELA);
    if (!bruto) return null;
    const salvo = JSON.parse(bruto) as { id?: string; carimbo?: string };
    // se veio copiado de outra janela, não vale
    if (!salvo?.id || salvo.carimbo !== carimboDaJanela()) return null;
    return salvo.id;
  } catch {
    return null;
  }
}


/* ---------------------------------------------------------------
   Aviso de saída: ao sair da conta na janela principal, todas as
   telas extras se fecham junto.
---------------------------------------------------------------- */

const CANAL_SAIDA = "sentinela:saida";
const janelasAbertas = new Map<string, Window>();

/** Janela principal: avisa as telas extras que o usuário saiu. */
export function avisarSaida() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE_FECHAMENTO_COLETIVO, String(Date.now()));
  } catch {
    /* ignora */
  }
  try {
    const bc = new BroadcastChannel(CANAL_SAIDA);
    bc.postMessage("saiu");
    bc.close();
  } catch {
    /* ignora */
  }
  try {
    window.localStorage.setItem(CANAL_SAIDA, String(Date.now()));
  } catch {
    /* ignora */
  }
  // A janela principal também mantém a referência direta das telas que abriu.
  // Assim elas fecham mesmo se o BroadcastChannel/storage atrasar ou falhar.
  for (const janela of janelasAbertas.values()) {
    try {
      if (!janela.closed) janela.close();
    } catch {
      /* a tela ainda receberá o aviso acima */
    }
  }
  janelasAbertas.clear();
}

/** Tela extra: escuta o aviso de saída da janela principal. */
export function ouvirSaida(aoSair: () => void) {
  if (typeof window === "undefined") return () => {};
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CANAL_SAIDA);
    bc.onmessage = () => aoSair();
  } catch {
    bc = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === CANAL_SAIDA) aoSair();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bc?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/* ----------------------------------------------------------------
    Sinal de vida da janela principal: as telas extras se fecham
    quando a principal é fechada (X da janela, navegador encerrado
    ou aba recarregada para fora do sistema).
 ---------------------------------------------------------------- */

const CHAVE_PRINCIPAL_VIVA = "sentinela:principal-viva";
const CANAL_PRINCIPAL = "sentinela:principal-ciclo";
const INTERVALO_PRINCIPAL_MS = 2000;
// Abas em segundo plano têm os temporizadores reduzidos pelo navegador (até 1x/min);
// o fechamento rápido vem do aviso de saída e do window.opener.
const LIMITE_PRINCIPAL_MS = 150_000;
// Tempo que a tela extra espera depois do aviso de saída da principal: um
// simples recarregamento volta a publicar presença dentro desse prazo.
const ESPERA_SAIDA_PRINCIPAL_MS = 3000;

/** Janela principal: publica presença contínua. */
export function registrarPrincipalViva() {
  if (typeof window === "undefined") return () => {};
  const publicar = () => {
    try {
      window.localStorage.setItem(CHAVE_PRINCIPAL_VIVA, String(Date.now()));
    } catch {
      /* ignora */
    }
  };
  // aviso imediato de fechamento: as telas extras não precisam esperar o
  // tempo do sinal de presença para perceber que a principal foi fechada
  const avisarSaidaImediata = () => {
    try {
      const bc = new BroadcastChannel(CANAL_PRINCIPAL);
      bc.postMessage({ tipo: "saindo", em: Date.now() });
      bc.close();
    } catch {
      /* ignora */
    }
  };
  publicar();
  const t = setInterval(publicar, INTERVALO_PRINCIPAL_MS);
  const aoVisibilizar = () => publicar();
  window.addEventListener("focus", aoVisibilizar);
  window.addEventListener("visibilitychange", aoVisibilizar);
  window.addEventListener("pagehide", avisarSaidaImediata);
  return () => {
    clearInterval(t);
    window.removeEventListener("focus", aoVisibilizar);
    window.removeEventListener("visibilitychange", aoVisibilizar);
    window.removeEventListener("pagehide", avisarSaidaImediata);
  };
}

/** Tela extra: fecha quando a janela principal para de dar sinal. */
export function vigiarPrincipal(aoFechar: () => void) {
  if (typeof window === "undefined") return () => {};
  const inicio = Date.now();
  const presencaEm = () => {
    try {
      return Number(window.localStorage.getItem(CHAVE_PRINCIPAL_VIVA)) || 0;
    } catch {
      return -1;
    }
  };
  const conferir = () => {
    const em = presencaEm();
    if (em < 0) return;
    // carência inicial: a principal pode estar recarregando
    if (!em && Date.now() - inicio < LIMITE_PRINCIPAL_MS) return;
    if (Date.now() - em > LIMITE_PRINCIPAL_MS) aoFechar();
  };
  const t = setInterval(conferir, INTERVALO_PRINCIPAL_MS);
  let aguardando: number | null = null;
  const aoAvisoDeSaida = () => {
    if (aguardando) return;
    aguardando = window.setTimeout(() => {
      aguardando = null;
      const em = presencaEm();
      // recarregou: presença voltou a ser publicada agora há pouco
      if (em > 0 && Date.now() - em <= ESPERA_SAIDA_PRINCIPAL_MS) return;
      aoFechar();
    }, ESPERA_SAIDA_PRINCIPAL_MS);
  };
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CANAL_PRINCIPAL);
    bc.onmessage = (e) => {
      if (e.data?.tipo === "saindo") aoAvisoDeSaida();
    };
  } catch {
    bc = null;
  }
  // a janela principal é quem abriu esta: se ela sumiu, fecha na hora
  const conferirAbridor = () => {
    try {
      if (window.opener && window.opener.closed) aoFechar();
    } catch {
      /* ignora */
    }
  };
  const t2 = setInterval(conferirAbridor, 500);
  return () => {
    clearInterval(t);
    clearInterval(t2);
    if (aguardando) window.clearTimeout(aguardando);
    bc?.close();
  };
}

export function urlDaTela(tela: TelaExtra) {
  const p = new URLSearchParams({ tela: tela.id });
  if (tela.layoutId) p.set("layout", tela.layoutId);
  if (tela.clienteId) p.set("cliente", tela.clienteId);
  if (tela.telaCheia !== false) p.set("cheia", "1");
  if (tela.monitorId) p.set("mon", tela.monitorId);
  if (tela.monitorAbertura) p.set("ini", tela.monitorAbertura);
  return `/visualizacao?${p.toString()}`;
}

export function abrirTela(tela: TelaExtra): Window | null {
  const cheia = tela.telaCheia !== false;
  const features = `popup=yes,left=${Math.round(tela.left)},top=${Math.round(tela.top)},width=${Math.round(
    tela.width,
  )},height=${Math.round(tela.height)}${cheia ? ",fullscreen=yes" : ""}`;
  const janela = window.open(urlDaTela(tela), `sentinela-tela-${tela.id}`, features);
  if (janela) {
    janelasAbertas.set(tela.id, janela);
    // segura o identificador até a janela começar a dar sinal de vida
    reservarIdTela(tela.id);
  }
  return janela;
}

/**
 * Reserva as janelas enquanto o clique do usuário ainda está ativo.
 * Abre direto na URL final (nada de about:blank, que deixava a tela em branco
 * quando o navegador barrava a troca de endereço depois).
 */
export function reservarTelas(lista: TelaExtra[]): Map<string, Window> {
  const reservadas = new Map<string, Window>();
  for (const tela of lista) {
    const janela = janelaDaTela(tela.id) ?? abrirTela(tela);
    if (janela) reservadas.set(tela.id, janela);
  }
  return reservadas;
}

/** Janela realmente aberta desta tela (null quando já foi fechada). */
export function janelaDaTela(id: string): Window | null {
  const j = janelasAbertas.get(id);
  if (!j || j.closed) {
    janelasAbertas.delete(id);
    return null;
  }
  return j;
}

export type ResultadoRestauracao = {
  abertas: number;
  bloqueadas: TelaExtra[];
  /** telas cujo monitor original não está conectado e abriram em outro */
  realocadas: TelaExtra[];
};

/**
 * Reabre uma lista de telas, cada uma no monitor em que foi deixada.
 * Monitor desconectado: a tela abre num monitor livre, mas a memória do
 * monitor original é preservada para quando ele voltar.
 */
export async function restaurarTelas(
  lista: TelaExtra[],
  registrar?: (tela: TelaExtra, janela: Window) => void,
  reservadas?: Map<string, Window>,
): Promise<ResultadoRestauracao> {
  const mons = (await monitoresAutorizados()) ? await listarMonitores() : [];
  lista = consolidarPorMonitor(lista, mons);
  let abertas = 0;
  const bloqueadas: TelaExtra[] = [];
  const realocadas: TelaExtra[] = [];
  // duas telas não podem abrir exatamente uma sobre a outra (pareceria que só
  // uma abriu): a segunda vai para um monitor livre ou fica deslocada.
  const monitoresUsados = new Set<string>();
  let empilhadas = 0;
  for (const t of lista) {
    let alvo: TelaExtra = ajustarAoMonitor(t, mons);
    const original = encontrarMonitor(mons, t.monitorId, monitoresUsados);
    const ausente = !!t.monitorId && mons.length > 0 && !original;

    let destino: MonitorInfo | null =
      original && !monitoresUsados.has(original.id) ? original : null;
    if (!destino && mons.length) {
      destino = mons.find((m) => !monitoresUsados.has(m.id)) ?? original ?? null;
    }
    if (destino && (ausente || alvo.telaCheia !== false || destino.id !== original?.id)) {
      alvo = {
        ...alvo,
        left: destino.left,
        top: destino.top,
        width: destino.width,
        height: destino.height,
      };
    }
    // o identificador do monitor guardado NUNCA é sobrescrito aqui
    alvo = { ...alvo, monitorId: t.monitorId ?? null, monitorAbertura: destino?.id ?? null };

    if (destino && monitoresUsados.has(destino.id)) {
      empilhadas += 1;
      const desloc = empilhadas * 60;
      alvo = {
        ...alvo,
        left: alvo.left + desloc,
        top: alvo.top + desloc,
        width: Math.max(640, alvo.width - desloc * 2),
        height: Math.max(480, alvo.height - desloc * 2),
        telaCheia: false,
      };
    }
    if (destino) monitoresUsados.add(destino.id);
    if (ausente && destino) realocadas.push(alvo);

    const reservada = reservadas?.get(t.id) ?? janelaDaTela(t.id);
    const w: Window | null = reservada && !reservada.closed ? reservada : abrirTela(alvo);
    if (w && reservada) {
      // já está aberta na URL certa: só reposiciona no monitor guardado
      try {
        w.moveTo(Math.round(alvo.left), Math.round(alvo.top));
        w.resizeTo(Math.round(alvo.width), Math.round(alvo.height));
        if (urlDaTela(alvo) !== urlDaTela(t)) w.location.replace(urlDaTela(alvo));
        janelasAbertas.set(alvo.id, w);
      } catch {
        /* alguns navegadores não deixam mover a janela: mantém como está */
      }
    }
    if (w) {
      salvarTela(alvo);
      registrar?.(alvo, w);
      abertas++;
    } else {
      bloqueadas.push(alvo);
    }
  }
  return { abertas, bloqueadas, realocadas };
}

/**
 * Uma tela por monitor: descarta repetidas no mesmo monitor (prefere a da
 * organização salva, depois a mais recente), não abre no monitor onde a
 * janela principal já está e nunca passa de (monitores - 1) janelas.
 */
export function consolidarPorMonitor(lista: TelaExtra[], mons: MonitorInfo[]): TelaExtra[] {
  if (!mons.length) return lista;
  const principal =
    typeof window !== "undefined" && !emTelaExtra()
      ? monitorDaPosicao(mons, window.screenX, window.screenY, window.outerWidth, window.outerHeight)
      : null;
  const ordenadas = [...lista].sort((a, b) => {
    const oa = a.id.startsWith("organizado-") ? 1 : 0;
    const ob = b.id.startsWith("organizado-") ? 1 : 0;
    if (oa !== ob) return ob - oa;
    return (b.atualizadoEm ? Date.parse(b.atualizadoEm) : 0) - (a.atualizadoEm ? Date.parse(a.atualizadoEm) : 0);
  });
  const usados = new Set<string>();
  if (principal) usados.add(principal.id);
  const final: TelaExtra[] = [];
  for (const t of ordenadas) {
    const m =
      (t.monitorId ? encontrarMonitor(mons, t.monitorId) : null) ??
      monitorDaPosicao(mons, t.left, t.top, t.width, t.height);
    if (m && usados.has(m.id)) {
      removerTela(t.id);
      continue;
    }
    if (m) usados.add(m.id);
    final.push(t);
  }
  const limite = Math.max(0, mons.length - (principal ? 1 : 0));
  return final.slice(0, limite);
}

/** Abre uma única tela (usado quando o navegador bloqueou a abertura em lote). */
export function abrirTelaAgora(tela: TelaExtra): Window | null {
  return janelaDaTela(tela.id) ?? abrirTela(tela);
}


/* ---------------------------------------------------------------
   Compartilhamento da sessão entre a janela principal e as telas
   extras: a tela extra pede a sessão para quem a abriu, evitando
   pedir login novamente.
---------------------------------------------------------------- */

const PEDIDO = "sentinela:pedir-sessao";
const RESPOSTA = "sentinela:sessao";

export type TokensSessao = { access_token: string; refresh_token: string };

/** Janela principal: responde às telas extras que pedirem a sessão. */
export function atenderPedidosDeSessao(obterTokens: () => TokensSessao | null) {
  if (typeof window === "undefined") return () => {};
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== PEDIDO) return;
    const alvo = e.source as Window | null;
    if (!alvo) return;
    alvo.postMessage({ type: RESPOSTA, tokens: obterTokens() }, window.location.origin);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Tela extra: pede a sessão para a janela que a abriu. */
export function pedirSessaoAoPai(timeout = 4000): Promise<TokensSessao | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const pai = window.opener as Window | null;
  if (!pai || pai.closed) return Promise.resolve(null);

  return new Promise((resolve) => {
    let pronto = false;
    const finalizar = (tokens: TokensSessao | null) => {
      if (pronto) return;
      pronto = true;
      clearInterval(tentativas);
      clearTimeout(limite);
      window.removeEventListener("message", onMessage);
      resolve(tokens);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== RESPOSTA) return;
      finalizar((e.data.tokens as TokensSessao | null) ?? null);
    };
    window.addEventListener("message", onMessage);
    const pedir = () => {
      try {
        pai.postMessage({ type: PEDIDO }, window.location.origin);
      } catch {
        /* ignora */
      }
    };
    pedir();
    const tentativas = setInterval(pedir, 400);
    const limite = setTimeout(() => finalizar(null), timeout);
  });
}

/* ---------------------------------------------------------------
   Troca de layout de cada tela, comandada pela janela principal.
---------------------------------------------------------------- */

const CANAL_LAYOUT = "sentinela:layout-tela";
const CHAVE_LAYOUT_TELA = "sentinela:layout-tela";
/** ordem guardada por tela: a janela nova aplica assim que termina de abrir */
const CHAVE_ORDEM_TELA = "sentinela:ordem-layout:";
/** uma ordem antiga não deve sobrepor a escolha atual da tela */
const VALIDADE_ORDEM_MS = 60_000;

type OrdemLayout = {
  telaId: string;
  layoutId: string | null;
  clienteId: string | null;
  em: number;
};

/**
 * A ordem é endereçada pelo código da tela, não pela referência da janela:
 * continua funcionando depois de recarregar a tela principal.
 */
export function enviarLayoutParaTela(
  telaId: string,
  layoutId: string | null,
  clienteId: string | null,
) {
  if (typeof window === "undefined") return false;
  const ordem: OrdemLayout = { telaId, layoutId, clienteId, em: Date.now() };
  let ok = false;
  try {
    const bc = new BroadcastChannel(CANAL_LAYOUT);
    bc.postMessage(ordem);
    bc.close();
    ok = true;
  } catch {
    /* sem BroadcastChannel: vai pelo localStorage */
  }
  try {
    window.localStorage.setItem(CHAVE_LAYOUT_TELA, JSON.stringify(ordem));
    // guardada também por tela: se a janela ainda estava abrindo, ela lê ao entrar
    window.localStorage.setItem(`${CHAVE_ORDEM_TELA}${telaId}`, JSON.stringify(ordem));
    ok = true;
  } catch {
    /* ignora */
  }
  return ok;
}

/** Ordem recente endereçada a esta tela, ainda não aplicada. */
export function ordemPendenteDaTela(telaId: string): OrdemLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${CHAVE_ORDEM_TELA}${telaId}`);
    if (!raw) return null;
    const ordem = JSON.parse(raw) as OrdemLayout;
    if (!ordem || ordem.telaId !== telaId) return null;
    if (!Number.isFinite(ordem.em) || Date.now() - ordem.em > VALIDADE_ORDEM_MS) return null;
    return ordem;
  } catch {
    return null;
  }
}

/** Tela extra: escuta apenas as ordens endereçadas a ela. */
export function ouvirLayoutDaTela(
  telaId: string,
  aplicar: (dados: { layoutId: string | null; clienteId: string | null }) => void,
) {
  if (typeof window === "undefined") return () => {};
  let ultima = 0;
  const tratar = (ordem: OrdemLayout | null) => {
    if (!ordem || ordem.telaId !== telaId) return;
    if (ordem.em <= ultima) return;
    ultima = ordem.em;
    aplicar({ layoutId: ordem.layoutId ?? null, clienteId: ordem.clienteId ?? null });
  };
  // ordem enviada enquanto esta janela ainda carregava
  tratar(ordemPendenteDaTela(telaId));
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CANAL_LAYOUT);
    bc.onmessage = (e) => tratar(e.data as OrdemLayout);
  } catch {
    bc = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CHAVE_LAYOUT_TELA || !e.newValue) return;
    try {
      tratar(JSON.parse(e.newValue) as OrdemLayout);
    } catch {
      /* ignora mensagem inválida */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bc?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/* ---------------------------------------------------------------
   Memória das telas na conta do usuário: o conjunto de telas volta
   em qualquer computador onde ele entrar.
---------------------------------------------------------------- */

type LinhaTela = {
  tela_id: string;
  layout_id: string | null;
  cliente_id: string | null;
  pos_left: number;
  pos_top: number;
  largura: number;
  altura: number;
  monitor_id: string | null;
  tela_cheia: boolean;
  atualizado_em: string;
};

const tabelaTelas = () =>
  (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => Promise<{ data: LinhaTela[] | null }>;
        };
        upsert: (
          v: Record<string, unknown>,
          o: Record<string, unknown>,
        ) => Promise<{ error: unknown }>;
        delete: () => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => Promise<{ error: unknown }>;
          };
        };
      };
    }
  ).from("telas_usuario");

export async function lerTelasRemotas(userId: string): Promise<TelaExtra[]> {
  try {
    const { data } = await tabelaTelas().select("*").eq("user_id", userId);
    return (data ?? []).map((l) => ({
      id: l.tela_id,
      layoutId: l.layout_id,
      clienteId: l.cliente_id,
      left: l.pos_left,
      top: l.pos_top,
      width: l.largura,
      height: l.altura,
      monitorId: l.monitor_id,
      telaCheia: l.tela_cheia,
      atualizadoEm: l.atualizado_em,
    }));
  } catch {
    return [];
  }
}

/**
 * Remove apenas registros repetidos da mesma tela (mantendo o mais recente).
 * Telas em monitores desconectados continuam guardadas.
 */
export function consolidarTelas(lista: TelaExtra[]): { telas: TelaExtra[]; removidas: TelaExtra[] } {
  const ordenadas = [...lista].sort((a, b) => {
    const ta = a.atualizadoEm ? Date.parse(a.atualizadoEm) : 0;
    const tb = b.atualizadoEm ? Date.parse(b.atualizadoEm) : 0;
    return tb - ta;
  });
  const vistas = new Set<string>();
  const telas: TelaExtra[] = [];
  const removidas: TelaExtra[] = [];
  for (const tela of ordenadas) {
    if (vistas.has(tela.id)) {
      removidas.push(tela);
      continue;
    }
    vistas.add(tela.id);
    telas.push(tela);
  }
  return { telas, removidas };
}

const ultimoEnvio = new Map<string, number>();

export async function salvarTelaRemota(userId: string, tela: TelaExtra, forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - (ultimoEnvio.get(tela.id) ?? 0) < 10_000) return;
  ultimoEnvio.set(tela.id, agora);
  try {
    await tabelaTelas().upsert(
      {
        user_id: userId,
        tela_id: tela.id,
        layout_id: tela.layoutId,
        cliente_id: tela.clienteId,
        pos_left: Math.round(tela.left),
        pos_top: Math.round(tela.top),
        largura: Math.round(tela.width),
        altura: Math.round(tela.height),
        monitor_id: tela.monitorId ?? null,
        tela_cheia: tela.telaCheia !== false,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "user_id,tela_id" },
    );
  } catch {
    /* ignora: a memória local continua valendo */
  }
}

export async function removerTelaRemota(userId: string, id: string) {
  ultimoEnvio.delete(id);
  try {
    await tabelaTelas().delete().eq("user_id", userId).eq("tela_id", id);
  } catch {
    /* ignora */
  }
}

export async function removerTelasRemotas(userId: string, ids: string[]) {
  await Promise.all(ids.map((id) => removerTelaRemota(userId, id)));
}
