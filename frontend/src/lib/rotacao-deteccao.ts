/**
 * Rotação de Layouts de detecção à prova de "thrashing".
 *
 * - Eventos repetidos do layout na tela (ou já pendente) são ignorados.
 * - No máximo UMA troca pendente: eventos em rajada são coalescidos
 *   (o mais recente vence).
 * - Ao abrir um layout, a retenção configurada já começa a contar. O layout
 *   troca quando a retenção vence, independente de as imagens terem aberto.
 * - Em paralelo, acompanha TODAS as câmeras únicas do layout: quem não
 *   apresentou o primeiro quadro em até 30 s é sinalizada como faltante
 *   (falha), apenas para exibição — nunca bloqueia a troca.
 */

export type FaseRotacao = "livre" | "aguardando-quadro" | "retendo";

export type EstadoRotacao = {
  fase: FaseRotacao;
  atual: string | null;
  pendente: string | null;
  /** Prazo de preparação venceu com câmeras sem quadro. */
  falha: boolean;
  /** Chaves das câmeras do layout atual que ainda não apresentaram quadro. */
  faltantes: string[];
  /** Total de câmeras únicas do layout atual. */
  total: number;
};

export type Relogio = {
  agendar: (fn: () => void, ms: number) => unknown;
  cancelar: (id: unknown) => void;
};

export type OpcoesRotacao = {
  /** Retenção configurada (ms), contada a partir da abertura do layout. */
  retencaoMs: number;
  /** Tempo mínimo de exibição quando não há retenção configurada (ms). */
  minimoExibicaoMs?: number;
  /** Prazo para sinalizar câmeras que não apresentaram quadro (ms). */
  prazoInicioMs?: number;
  /** Chaves "dvr_id:canal" das câmeras de um layout. */
  camerasDe: (layoutId: string) => string[];
  abrir: (layoutId: string) => void;
  aoMudar?: (estado: EstadoRotacao) => void;
  relogio?: Relogio;
};

export const MINIMO_EXIBICAO_MS = 15000;
export const PRAZO_INICIO_MS = 30000;

export const chaveCamera = (dvrId: string, canal: number) => `${dvrId.toLowerCase()}:${canal}`;

export class RotacaoDeteccao {
  private fase: FaseRotacao = "livre";
  private atual: string | null = null;
  private pendente: string | null = null;
  private falha = false;
  private timer: unknown = null;
  private timerPrazo: unknown = null;
  private esperadas = new Set<string>();
  private carregadas = new Set<string>();
  private encerrado = false;
  private readonly relogio: Relogio;

  constructor(private readonly op: OpcoesRotacao) {
    this.relogio = op.relogio ?? {
      agendar: (fn, ms) => setTimeout(fn, ms),
      cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
  }

  estado(): EstadoRotacao {
    return {
      fase: this.fase,
      atual: this.atual,
      pendente: this.pendente,
      falha: this.falha,
      faltantes: [...this.esperadas].filter((c) => !this.carregadas.has(c)),
      total: this.esperadas.size,
    };
  }

  /**
   * Layout já na tela sem passar pela rotação (ex.: primeiro da sequência).
   * Inicia a mesma espera por TODOS os quadros + retenção, sem chamar `abrir`.
   */
  definirAtual(layoutId: string | null) {
    if (this.encerrado) return;
    this.cancelarTimer();
    this.cancelarPrazo();
    if (!layoutId) {
      this.atual = null;
      this.esperadas = new Set();
      this.carregadas = new Set();
      this.falha = false;
      this.fase = "livre";
      this.notificar();
      return;
    }
    this.preparar(layoutId, false);
  }

  /** Evento de movimento resolvido para um layout. Retorna o que aconteceu. */
  evento(layoutId: string): "ignorado-na-tela" | "ignorado-pendente" | "pendente" | "abrindo" {
    if (this.encerrado) return "ignorado-na-tela";
    if (layoutId === this.atual) return "ignorado-na-tela";
    if (layoutId === this.pendente) return "ignorado-pendente";
    this.pendente = layoutId;
    if (this.fase === "livre") {
      this.ativar();
      return "abrindo";
    }
    this.notificar();
    return "pendente";
  }

  /** Primeiro quadro apresentado por uma câmera visível. */
  primeiroQuadro(chave: string) {
    if (this.encerrado || !this.esperadas.has(chave) || this.carregadas.has(chave)) return;
    this.carregadas.add(chave);
    if (this.carregadas.size >= this.esperadas.size) {
      // Todas apresentaram quadro: cancela o prazo de sinalização de falha.
      this.cancelarPrazo();
      if (this.fase === "aguardando-quadro") this.fase = "retendo";
    }
    this.notificar();
  }

  encerrar() {
    this.encerrado = true;
    this.cancelarTimer();
    this.cancelarPrazo();
    this.pendente = null;
  }

  private ativar() {
    const proximo = this.pendente;
    if (!proximo) return;
    this.pendente = null;
    this.preparar(proximo, true);
  }

  private preparar(proximo: string, abrir: boolean) {
    this.cancelarPrazo();
    this.atual = proximo;
    this.falha = false;
    this.esperadas = new Set(this.op.camerasDe(proximo));
    // Slots mudam entre layouts e os players são remontados: não há prova de
    // que o mesmo vídeo continuou exibindo. Prontidão sempre recomeça do zero.
    this.carregadas = new Set();
    this.fase = "aguardando-quadro";
    this.notificar();
    if (abrir) this.op.abrir(proximo);
    // A retenção conta desde a abertura do layout, sem esperar as imagens.
    this.iniciarRetencao();
    if (this.carregadas.size >= this.esperadas.size) return;
    const prazo = this.op.prazoInicioMs ?? PRAZO_INICIO_MS;
    this.timerPrazo = this.relogio.agendar(() => {
      this.timerPrazo = null;
      if (this.fase === "livre" && this.atual !== proximo) return;
      // Prazo vencido: sinaliza as câmeras que ficaram sem imagem.
      this.falha = true;
      if (this.fase === "aguardando-quadro") this.fase = "retendo";
      this.notificar();
    }, prazo);
  }

  private iniciarRetencao() {
    // Retenção configurada vale como está; o mínimo só entra quando não há retenção.
    const ms =
      this.op.retencaoMs > 0 ? this.op.retencaoMs : (this.op.minimoExibicaoMs ?? MINIMO_EXIBICAO_MS);
    this.timer = this.relogio.agendar(() => {
      this.timer = null;
      this.fase = "livre";
      if (this.pendente) this.ativar();
      else this.notificar();
    }, ms);
  }

  private cancelarTimer() {
    if (this.timer !== null) this.relogio.cancelar(this.timer);
    this.timer = null;
  }

  private cancelarPrazo() {
    if (this.timerPrazo !== null) this.relogio.cancelar(this.timerPrazo);
    this.timerPrazo = null;
  }

  private notificar() {
    this.op.aoMudar?.(this.estado());
  }
}

/** Evento global emitido pelo player quando apresenta o primeiro quadro. */
export const EVENTO_PRIMEIRO_QUADRO = "sentinela:primeiro-quadro";
export type DetalhePrimeiroQuadro = { dvrId: string; canal: number };
