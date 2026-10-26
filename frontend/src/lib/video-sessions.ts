export type EstadoSessao = "solicitada" | "conectando" | "publicando" | "erro" | "encerrada";

export type StatusSessao = {
  session_id: string;
  estado: EstadoSessao;
  diagnostico: string | null;
  whep_url: string | null;
  hls_url: string | null;
  expires_at: string;
};

import { supabase } from "@/integrations/supabase/client";

/**
 * Só aceitamos endereços HLS reais: absolutos, HTTPS e sem domínios de
 * exemplo. Sem isso, nada de player alternativo — o vídeo continua no WebRTC.
 */
const DOMINIOS_EXEMPLO = ["seudominio", "example.com", "teste.flowhelp"];
export function hlsValido(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (DOMINIOS_EXEMPLO.some((d) => u.hostname.includes(d))) return null;
    return u.toString();
  } catch {
    return null;
  }
}


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

/** Cria (ou reaproveita) a solicitação de vídeo. Nunca devolve endereços aqui. */
export async function abrirSessao(
  dvrId: string,
  canal: number,
  opcoes?: { entrega?: "padrao" | "direto"; qualidade?: "extra" | "principal" },
): Promise<{ session_id: string; estado: EstadoSessao }> {
  const res = await fetch("/api/video/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await auth()) },
    body: JSON.stringify({ dvr_id: dvrId, canal, ...(opcoes ?? {}) }),
  });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as { session_id: string; estado: EstadoSessao };
}

/** Estado atual da sessão; endereços só chegam quando o servidor local já está publicando. */
export async function statusSessao(id: string): Promise<StatusSessao> {
  const res = await fetch(`/api/video/sessions/${id}`, { headers: await auth() });
  if (!res.ok) throw await erroDe(res);
  return (await res.json()) as StatusSessao;
}

export async function manterSessao(id: string): Promise<{ estado: string } | null> {
  const res = await fetch(`/api/video/sessions/${id}/keepalive`, {
    method: "POST",
    headers: await auth(),
  });
  if (!res.ok) return null;
  return (await res.json()) as { estado: string };
}

export async function encerrarSessao(id: string): Promise<void> {
  await fetch(`/api/video/sessions/${id}`, { method: "DELETE", headers: await auth() });
}
