import { supabase } from "@/integrations/supabase/client";

export type StatusReproducao = {
  session_id: string;
  recording_id: string | null;
  estado: string;
  diagnostico: string | null;
  playback_url: string | null;
  answer_sdp: string | null;
  modo: string | null;
  entregue_em?: string | null;
  ultimo_sinal_agente?: string | null;
  expires_at: string;
};

export type AcaoReproducao = "reproduzir" | "pausar" | "buscar" | "velocidade";

async function auth(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function erroDe(res: Response): Promise<Error> {
  const texto = await res.text();
  try {
    const j = JSON.parse(texto) as { erro?: string };
    return new Error(j.erro ?? texto);
  } catch {
    return new Error(texto || "Falha ao falar com o servidor");
  }
}

/** Cria exatamente uma solicitação de reprodução para o arquivo indicado. */
export async function pedirReproducao(
  recordingId: string,
  offerSdp?: string,
): Promise<{ session_id: string; modo: string }> {
  const res = await fetch("/api/video/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await auth()) },
    body: JSON.stringify({
      recording_id: recordingId,
      ...(offerSdp ? { offer_sdp: offerSdp } : {}),
    }),
  });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as { session_id: string; modo: string };
}

export async function statusReproducao(id: string): Promise<StatusReproducao> {
  const res = await fetch(`/api/video/recordings/${id}`, { headers: await auth() });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as StatusReproducao;
}

export async function encerrarReproducao(id: string): Promise<void> {
  await fetch(`/api/video/recordings/${id}`, { method: "DELETE", headers: await auth() });
}

export async function controlarReproducao(
  id: string,
  acao: AcaoReproducao,
  posicaoSegundos?: number,
  velocidade?: number,
): Promise<void> {
  const res = await fetch(`/api/video/recordings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await auth()) },
    body: JSON.stringify({
      acao,
      ...(posicaoSegundos !== undefined
        ? { posicao_segundos: Math.max(0, posicaoSegundos) }
        : {}),
      ...(velocidade !== undefined ? { velocidade } : {}),
    }),
  });
  if (!res.ok) throw await erroDe(res);
}
