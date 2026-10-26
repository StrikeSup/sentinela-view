import { supabase } from "@/integrations/supabase/client";

export type EstadoExport =
  | "requested"
  | "preparando"
  | "enviando"
  | "upload_concluido"
  | "ready"
  | "erro";

export type StatusExport = {
  export_id: string;
  estado: EstadoExport;
  etapa?: string | null;
  bytes_enviados: number;
  tamanho_bytes: number | null;
  erro: string | null;
  download_url: string | null;
};

async function auth(): Promise<Record<string, string>> {
  const agora = Date.now();
  if (tokenCache && tokenCache.validoAte > agora) {
    return { Authorization: `Bearer ${tokenCache.token}` };
  }
  if (!tokenPendente) {
    tokenPendente = supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token ?? null;
      const expiraEm = data.session?.expires_at ? data.session.expires_at * 1000 - 30_000 : agora;
      tokenCache = token ? { token, validoAte: Math.min(expiraEm, agora + 60_000) } : null;
      return token;
    }).finally(() => {
      tokenPendente = null;
    });
  }
  const token = await tokenPendente;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let tokenCache: { token: string; validoAte: number } | null = null;
let tokenPendente: Promise<string | null> | null = null;

async function erroDe(res: Response): Promise<Error> {
  const texto = await res.text();
  try {
    const j = JSON.parse(texto) as { erro?: string };
    return new Error(j.erro ?? texto);
  } catch {
    return new Error(texto || "Falha ao falar com o servidor");
  }
}

type ResultadoLote = StatusExport & { recording_id: string; erro_solicitacao?: string };
type PedidoPendente = {
  resolve: (status: StatusExport) => void;
  reject: (erro: Error) => void;
};

const pedidosPendentes = new Map<string, PedidoPendente[]>();
let timerLote: ReturnType<typeof setTimeout> | null = null;

async function enviarLote() {
  timerLote = null;
  const lote = new Map(pedidosPendentes);
  pedidosPendentes.clear();
  const ids = Array.from(lote.keys());
  if (!ids.length) return;

  try {
    const res = await fetch("/api/video/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify({ recording_ids: ids }),
    });
    if (!res.ok) throw await erroDe(res);
    const corpo = (await res.json()) as { resultados?: ResultadoLote[] };
    const resultados = new Map((corpo.resultados ?? []).map((item) => [item.recording_id, item]));
    for (const [id, aguardando] of lote) {
      const resultado = resultados.get(id);
      const erro = resultado?.erro_solicitacao;
      for (const pedido of aguardando) {
        if (!resultado || erro) pedido.reject(new Error(erro ?? "A gravação não foi solicitada."));
        else pedido.resolve(resultado);
      }
    }
  } catch (erro) {
    const falha = erro instanceof Error ? erro : new Error("Falha ao solicitar as gravações.");
    for (const aguardando of lote.values()) {
      for (const pedido of aguardando) pedido.reject(falha);
    }
  }
}

/**
 * Agrupa no mesmo pedido os arquivos solicitados pelos players no mesmo instante.
 * Cada chamada continua recebendo somente o estado da sua própria gravação.
 */
export function pedirArquivo(recordingId: string): Promise<StatusExport> {
  return new Promise((resolve, reject) => {
    const aguardando = pedidosPendentes.get(recordingId) ?? [];
    aguardando.push({ resolve, reject });
    pedidosPendentes.set(recordingId, aguardando);
    if (timerLote) clearTimeout(timerLote);
    timerLote = setTimeout(() => void enviarLote(), 40);
  });
}

/** Pedido individual sem agrupamento, mantido para integrações que precisem dele. */
export async function pedirArquivoIndividual(recordingId: string): Promise<StatusExport> {
  const res = await fetch("/api/video/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await auth()) },
    body: JSON.stringify({ recording_id: recordingId }),
  });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as StatusExport;
}

export async function statusArquivo(exportId: string): Promise<StatusExport> {
  const res = await fetch(`/api/video/exports/${exportId}`, { headers: await auth() });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as StatusExport;
}

/**
 * Libera a reserva; com `apagar` o arquivo temporário é removido na hora.
 * O keepalive faz a chamada valer também quando a aba está fechando.
 */
export async function liberarArquivo(exportId: string, apagar = false): Promise<void> {
  try {
    await fetch(`/api/video/exports/${exportId}${apagar ? "?apagar=1" : ""}`, {
      method: "DELETE",
      headers: await auth(),
      keepalive: true,
    });
  } catch {
    /* a limpeza agendada resolve */
  }
}
