/**
 * Memória local (IndexedDB) com METADADOS de visualização por câmera.
 * Nunca guarda vídeo, senha, token, SDP ou URL RTSP — apenas números usados
 * para ordenar e antecipar solicitações. A autorização continua no servidor.
 */
export type MemoriaCamera = {
  chave: string;
  dvr_id: string;
  canal: number;
  qualidade: string;
  last_viewed_at: string;
  view_count: number;
  last_success_at: string | null;
  average_start_ms: number | null;
  preferred_route: string | null;
};

const BANCO = "sentinela_video";
const LOJA = "cameras";

function chaveDe(dvrId: string, canal: number, qualidade: string) {
  return `${dvrId}:${canal}:${qualidade}`;
}

function abrir(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(BANCO, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA, { keyPath: "chave" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function transacao<T>(
  modo: IDBTransactionMode,
  executar: (loja: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await abrir();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LOJA, modo);
      const req = executar(tx.objectStore(LOJA));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

export async function lerMemoriaCamera(
  dvrId: string,
  canal: number,
  qualidade = "extra",
): Promise<MemoriaCamera | null> {
  return transacao<MemoriaCamera>("readonly", (loja) =>
    loja.get(chaveDe(dvrId, canal, qualidade)) as IDBRequest<MemoriaCamera>,
  );
}

export async function listarMemoriaCameras(): Promise<MemoriaCamera[]> {
  const todas = await transacao<MemoriaCamera[]>(
    "readonly",
    (loja) => loja.getAll() as IDBRequest<MemoriaCamera[]>,
  );
  return todas ?? [];
}

/** Registra a abertura da câmera (contador + horário). */
export async function registrarVisualizacao(dvrId: string, canal: number, qualidade = "extra") {
  const atual = await lerMemoriaCamera(dvrId, canal, qualidade);
  const registro: MemoriaCamera = {
    chave: chaveDe(dvrId, canal, qualidade),
    dvr_id: dvrId,
    canal,
    qualidade,
    last_viewed_at: new Date().toISOString(),
    view_count: (atual?.view_count ?? 0) + 1,
    last_success_at: atual?.last_success_at ?? null,
    average_start_ms: atual?.average_start_ms ?? null,
    preferred_route: atual?.preferred_route ?? null,
  };
  await transacao("readwrite", (loja) => loja.put(registro) as IDBRequest<IDBValidKey>);
}

/** Registra o tempo até o primeiro quadro e a rota efetivamente usada. */
export async function registrarSucesso(
  dvrId: string,
  canal: number,
  qualidade: string,
  tempoMs: number,
  rota: string | null,
) {
  const atual = await lerMemoriaCamera(dvrId, canal, qualidade);
  const media = atual?.average_start_ms
    ? Math.round(atual.average_start_ms * 0.7 + tempoMs * 0.3)
    : Math.round(tempoMs);
  const registro: MemoriaCamera = {
    chave: chaveDe(dvrId, canal, qualidade),
    dvr_id: dvrId,
    canal,
    qualidade,
    last_viewed_at: atual?.last_viewed_at ?? new Date().toISOString(),
    view_count: atual?.view_count ?? 1,
    last_success_at: new Date().toISOString(),
    average_start_ms: media,
    preferred_route: rota ?? atual?.preferred_route ?? null,
  };
  await transacao("readwrite", (loja) => loja.put(registro) as IDBRequest<IDBValidKey>);
}
