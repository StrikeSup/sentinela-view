/**
 * Marcha das conexões de vídeo.
 *
 * Cada janela aberta tem a sua própria fila de conexões. Com várias telas
 * abertas ao mesmo tempo, dezenas de pedidos chegavam no mesmo instante ao
 * servidor de imagens, que precisa preparar um conversor por câmera — o
 * resultado eram câmeras presas em "Carregando" e quadros pretos.
 *
 * Aqui todas as janelas do mesmo navegador combinam um ritmo mínimo entre os
 * pedidos, gravando no armazenamento local o horário do último início.
 */

const CHAVE = "sentinela:marcha-conexoes";
/** intervalo mínimo entre dois pedidos de vídeo, somando todas as janelas */
const INTERVALO_MS = 30;
/** nunca esperar mais que isso, mesmo com muita gente na fila */
const ESPERA_MAXIMA_MS = 8000;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Aguarda a vez de iniciar mais um pedido de vídeo. */
export async function aguardarMarcha(): Promise<void> {
  if (typeof window === "undefined") return;
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  for (;;) {
    let ultimo = 0;
    try {
      ultimo = Number(window.localStorage.getItem(CHAVE)) || 0;
    } catch {
      return;
    }
    const agora = Date.now();
    // relógio adiantado ou registro inválido: recomeça a contagem
    if (ultimo > agora + INTERVALO_MS) ultimo = 0;
    const falta = ultimo + INTERVALO_MS - agora;
    if (falta <= 0 || agora >= limite) {
      try {
        window.localStorage.setItem(CHAVE, String(agora));
      } catch {
        /* segue sem o ritmo combinado */
      }
      // pequena variação evita que duas janelas peguem exatamente a mesma vez
      await dormir(Math.floor(Math.random() * 60));
      return;
    }
    // Espera o tempo que falta de uma vez: acordar de 120 em 120 ms para ler
    // o armazenamento local travava a página quando havia muitas câmeras na
    // fila (cada leitura bloqueia o navegador).
    await dormir(Math.min(falta, 1500));
  }
}
