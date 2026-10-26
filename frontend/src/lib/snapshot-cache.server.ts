// Cache em memória dos snapshots enviados pelo Agent (modelo PUSH) e dos pedidos
// feitos pelo Gear. Server-only. O app roda como processo único na VPS.

const VALIDADE_FOTO_MS = 15_000; // quadro mais velho que isso não é entregue
const JANELA_PEDIDO_MS = 60_000; // Agent continua enviando por 60 s após o último pedido

type Foto = { bytes: ArrayBuffer; recebido: number };
type Estado = {
  fotos: Map<string, Foto>;
  pedidos: Map<string, Map<number, number>>; // dvr_id -> canal -> expira (ms)
};

const g = globalThis as unknown as { __sentinelaSnapshots?: Estado };
const estado: Estado = (g.__sentinelaSnapshots ??= { fotos: new Map(), pedidos: new Map() });

// stream: 0 = principal, 1 = extra (secundário). Sem stream = foto genérica do Agent.
const chave = (dvrId: string, canal: number, stream?: number) =>
  `${dvrId.toLowerCase()}:${canal}${stream === undefined ? "" : `:s${stream}`}`;

export function guardarSnapshot(dvrId: string, canal: number, bytes: ArrayBuffer, stream?: number) {
  estado.fotos.set(chave(dvrId, canal, stream), { bytes, recebido: Date.now() });
}

const RETENCAO_MAX_MS = 5 * 60_000; // último quadro conhecido serve de reserva por 5 min

export function lerSnapshot(
  dvrId: string,
  canal: number,
  maxIdadeMs = VALIDADE_FOTO_MS,
  stream?: number,
): ArrayBuffer | null {
  // Prefere a foto do stream pedido; senão a foto genérica (Agent que não informa stream).
  const chaves = stream === undefined ? [chave(dvrId, canal)] : [chave(dvrId, canal, stream), chave(dvrId, canal)];
  for (const k of chaves) {
    const f = estado.fotos.get(k);
    if (!f) continue;
    const idade = Date.now() - f.recebido;
    if (idade > RETENCAO_MAX_MS) {
      estado.fotos.delete(k);
      continue;
    }
    if (idade <= maxIdadeMs) return f.bytes;
  }
  return null;
}

const INTERVALO_CHECAGEM_MS = 80;

/**
 * Espera a foto chegar do Agent. Se já houver um quadro antigo (até 5 min), espera no
 * máximo ~1,2 s por um novo e entrega o antigo — o pedido já ficou registrado, então o
 * próximo acesso recebe a foto atualizada. Sem nenhum quadro, espera até `esperaMs`.
 */
export async function aguardarSnapshot(dvrId: string, canal: number, esperaMs = 6000, stream?: number) {
  const fresca = lerSnapshot(dvrId, canal, VALIDADE_FOTO_MS, stream);
  if (fresca) return fresca;
  // Havendo quadro recente (até 5 min), entrega na hora — sem espera. O pedido já foi
  // registrado, então o próximo acesso recebe a foto nova.
  const reserva = lerSnapshot(dvrId, canal, RETENCAO_MAX_MS, stream);
  if (reserva) return reserva;
  const fim = Date.now() + esperaMs;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, INTERVALO_CHECAGEM_MS));
    const f = lerSnapshot(dvrId, canal, VALIDADE_FOTO_MS, stream);
    if (f) return f;
  }
  return lerSnapshot(dvrId, canal, RETENCAO_MAX_MS, stream);
}

export function solicitarSnapshot(dvrId: string, canal: number) {
  const id = dvrId.toLowerCase();
  const canais = estado.pedidos.get(id) ?? new Map<number, number>();
  canais.set(canal, Date.now() + JANELA_PEDIDO_MS);
  estado.pedidos.set(id, canais);
}

/** Lista para o heartbeat do Agent, limitada aos DVRs deste servidor. */
export function snapshotsSolicitados(dvrIds: string[]) {
  const agora = Date.now();
  const saida: { dvr_id: string; canais: number[]; ate: string }[] = [];
  for (const raw of dvrIds) {
    const id = raw.toLowerCase();
    const canais = estado.pedidos.get(id);
    if (!canais) continue;
    let ate = 0;
    const ativos: number[] = [];
    for (const [c, exp] of canais) {
      if (exp <= agora) canais.delete(c);
      else {
        ativos.push(c);
        ate = Math.max(ate, exp);
      }
    }
    if (ativos.length === 0) {
      estado.pedidos.delete(id);
      continue;
    }
    saida.push({ dvr_id: id, canais: ativos.sort((a, b) => a - b), ate: new Date(ate).toISOString() });
  }
  return saida;
}
