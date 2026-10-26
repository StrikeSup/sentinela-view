import { supabase } from "@/integrations/supabase/client";

/**
 * Sinalização em tempo real das sessões de vídeo.
 *
 * Em vez de consultar a API a cada meio segundo esperando o `answer_sdp`,
 * o navegador assina as mudanças da linha em `video_sessions` pelo Supabase
 * Realtime (WebSocket já autenticado). Quando o agente grava a resposta, o
 * evento chega em milissegundos. Se o WebSocket não conectar ou cair, o
 * chamador continua consultando a API normalmente (fallback).
 */

type Aviso = () => void;

const ouvintes = new Map<string, Set<Aviso>>();
const canais = new Map<string, ReturnType<typeof supabase.channel>>();

function assinarSessao(sessionId: string, aviso: Aviso): () => void {
  let grupo = ouvintes.get(sessionId);
  if (!grupo) {
    grupo = new Set();
    ouvintes.set(sessionId, grupo);
    const canal = supabase
      .channel(`video_session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => {
          for (const fn of ouvintes.get(sessionId) ?? []) fn();
        },
      )
      .subscribe();
    canais.set(sessionId, canal);
  }
  grupo.add(aviso);

  return () => {
    const atual = ouvintes.get(sessionId);
    if (!atual) return;
    atual.delete(aviso);
    if (atual.size > 0) return;
    ouvintes.delete(sessionId);
    const canal = canais.get(sessionId);
    canais.delete(sessionId);
    if (canal) void supabase.removeChannel(canal);
  };
}

/**
 * Espera um sinal em tempo real da sessão, com limite de tempo.
 * Resolve imediatamente quando a linha muda; ao esgotar o tempo, resolve
 * assim mesmo para que o chamador faça a consulta de segurança (fallback).
 */
export function esperarSinalSessao(sessionId: string, limiteMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pronto = false;
    const terminar = () => {
      if (pronto) return;
      pronto = true;
      clearTimeout(t);
      cancelar();
      resolve();
    };
    const t = setTimeout(terminar, limiteMs);
    const cancelar = assinarSessao(sessionId, terminar);
  });
}
