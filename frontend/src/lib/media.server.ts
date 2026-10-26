// Utilitários server-only do plano de controle de vídeo.
// Nunca importe este arquivo em código do navegador.
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

export type MediaAction = "publish" | "read";
export type MediaTokenPayload = { p: string; a: MediaAction; sid: string; exp: number };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function segredo(): string {
  const s = process.env["MEDIA_TOKEN_SECRET"];
  if (!s) throw new Error("MEDIA_TOKEN_SECRET não configurado");
  return s;
}

export function assinarToken(payload: MediaTokenPayload): string {
  const corpo = b64url(JSON.stringify(payload));
  const assinatura = createHmac("sha256", segredo()).update(corpo).digest("base64url");
  return `${corpo}.${assinatura}`;
}

export function verificarToken(token: string | null | undefined): MediaTokenPayload | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes as [string, string];
  const esperada = createHmac("sha256", segredo()).update(corpo).digest("base64url");
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(corpo, "base64url").toString("utf8"),
    ) as MediaTokenPayload;
    if (!payload?.p || !payload?.a || !payload?.sid) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function novoPath(): string {
  return `sv_${randomBytes(9).toString("hex")}`;
}

export type ConfigMidia = { publish: string; whep: string; hls: string };

const limpar = (v: string) => v.replace(/\/+$/, "");

/**
 * Relay público opcional, definido apenas na infraestrutura (nunca em tela).
 * Quando ausente, o próprio servidor do cliente informa os endereços pela
 * conexão da licença.
 */
export function configMidiaInfra(): ConfigMidia | null {
  const publish = process.env["MEDIA_PUBLISH_BASE"]?.trim();
  const whep = process.env["MEDIA_WHEP_BASE"]?.trim();
  const hls = process.env["MEDIA_HLS_BASE"]?.trim();
  if (!publish || !whep || !hls) return null;
  return { publish: limpar(publish), whep: limpar(whep), hls: limpar(hls) };
}

/** Endereços entregues ao navegador; só devem ser usados quando a sessão está publicando. */
export function enderecosDeLeitura(sessao: {
  sessionId: string;
  path: string;
  whep: string | null;
  hls: string | null;
  expiraEm: string;
}): { whep_url: string | null; hls_url: string | null } {
  if (sessao.whep || sessao.hls) {
    return { whep_url: sessao.whep ?? null, hls_url: sessao.hls ?? null };
  }
  // Sem endereço informado pela sessão, usa o retransmissor da VPS (quando
  // configurado), com token de leitura assinado só para este path/sessão.
  const infra = configMidiaInfra();
  if (!infra) return { whep_url: null, hls_url: null };
  const exp = Math.floor(new Date(sessao.expiraEm).getTime() / 1000) + 300;
  const token = assinarToken({ p: sessao.path, a: "read", sid: sessao.sessionId, exp });
  return {
    whep_url: `${infra.whep}/${sessao.path}/whep?token=${token}`,
    hls_url: `${infra.hls}/${sessao.path}/index.m3u8?token=${token}`,
  };
}

/** Valida o token Bearer do usuário e devolve o id e um client com RLS do usuário. */
export async function usuarioDaRequisicao(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.split(".").length !== 3) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const { supabaseUrlServidor, supabasePublishableKeyServidor } =
    await import("@/integrations/supabase/config.server");
  const url = supabaseUrlServidor();
  const key = supabasePublishableKeyServidor();
  if (!url || !key) return null;

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  return { userId, client };
}

/** Permissão de visualizar câmeras (master/admin sempre podem). */
export async function podeVisualizar(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: admin }, { data: perm }] = await Promise.all([
    supabaseAdmin.rpc("is_admin", { _user_id: userId }),
    supabaseAdmin.rpc("has_permission", { _user_id: userId, _perm: "visualizacao.ver" }),
  ]);
  return Boolean(admin) || Boolean(perm);
}

/** Permissão de ver/reproduzir gravações (master/admin sempre podem). */
export async function podeVerGravacoes(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: admin }, { data: perm }] = await Promise.all([
    supabaseAdmin.rpc("is_admin", { _user_id: userId }),
    supabaseAdmin.rpc("has_permission", { _user_id: userId, _perm: "gravacoes.ver" }),
  ]);
  return Boolean(admin) || Boolean(perm);
}
