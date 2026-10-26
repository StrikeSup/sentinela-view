// API compatível com o D-Guard para o Gear. Server-only.
// Rotas paralelas em /api/*; não altera a API /api/public/v1.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const CORS_GEAR = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, userToken, token",
};

export const jsonGear = (dados: unknown, status = 200) =>
  Response.json(dados, { status, headers: { ...CORS_GEAR, "Cache-Control": "no-store" } });

export const opcoesGear = () => new Response(null, { status: 204, headers: CORS_GEAR });

type Candidato = { origem: string; valor: string };

/** Todos os acessos enviados (Authorization, userToken/token, ?token= / ?userToken=). */
function candidatosToken(request: Request): Candidato[] {
  const lista: Candidato[] = [];
  const h = request.headers.get("authorization");
  if (h) {
    const m = h.match(/^\s*(bearer|basic|token)?\s*(.+)$/i);
    if (m?.[2]) lista.push({ origem: `authorization-${(m[1] ?? "puro").toLowerCase()}`, valor: m[2].trim() });
  }
  const url = new URL(request.url);
  const extras: [string, string | null][] = [
    ["header-usertoken", request.headers.get("usertoken")],
    ["header-token", request.headers.get("token")],
    ["query-token", url.searchParams.get("token")],
    ["query-userToken", url.searchParams.get("userToken")],
  ];
  for (const [origem, v] of extras) if (v?.trim()) lista.push({ origem, valor: v.trim() });
  return lista;
}

/** Prefere o token do Gear (gear.*) quando o app manda mais de um. */
function extrairToken(request: Request): Candidato | null {
  const c = candidatosToken(request);
  return c.find((x) => x.valor.replace(/^"|"$/g, "").startsWith("gear.")) ?? c[0] ?? null;
}

/** Base64/base64url -> texto, tolerante a falta de "=" (o app do iPhone não manda). */
function decodificarBase64(valor: string): string {
  let b = valor.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
  b = b.replace(/=+$/, "");
  while (b.length % 4 !== 0) b += "=";
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Texto decodificado com letras/números trocados por x — mostra só a pontuação/estrutura. */
function mascararTexto(valor: string): string {
  try {
    const t = decodificarBase64(valor);
    return `[${t.length}b]` + t.slice(0, 80).replace(/[A-Za-z0-9]/g, "x").replace(/[^\x20-\x7e]/g, "?");
  } catch (e) {
    return `atob-falhou(${(e as Error).message.slice(0, 40)})`;
  }
}

/** Token "dados.assinatura" (2 partes): mostra os dados (não secretos) e só o tamanho da assinatura. */
function descreverAssinado(valor: string): string {
  const [dados, assinatura] = valor.split(".");
  let texto = "";
  try {
    texto = decodificarBase64(dados ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, 120);
  } catch {
    texto = "nao-decodifica";
  }
  return `dados=${texto} assinatura-len${assinatura?.length ?? 0}`;
}

/** Estrutura (só nomes de campos e tamanhos) de um acesso em base64/JSON, sem valores. */
function estruturaBase64(valor: string): string {
  try {
    const texto = decodificarBase64(valor);
    if (texto.trim().startsWith("{")) {
      const obj = JSON.parse(texto) as Record<string, unknown>;
      const campos = Object.entries(obj).map(([k, v]) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        const formato =
          typeof v === "string" && /^\{?[0-9a-f-]{36}\}?$/i.test(v) ? "guid" : typeof v;
        return `${k}=${formato}(${s?.length ?? 0})`;
      });
      return `json{${campos.join(";")}}`;
    }
    if (/^[^:\s]+:.+$/.test(texto)) return "usuario:senha";
    return "binario";
  } catch {
    return `nao-decodifica:${mascararTexto(valor)}`;
  }
}

/** Descrição segura (sem o segredo) do acesso enviado, para o log. */
export function descreverToken(request: Request): string {
  const c = candidatosToken(request);
  if (c.length === 0) return "sem-token";
  return c
    .map(({ origem, valor }) => {
      const tipo = valor.startsWith("gear.")
        ? "gear"
        : valor.split(".").length === 3
          ? "jwt"
          : valor.split(".").length === 2
            ? `assinado-por-terceiro:${descreverAssinado(valor)}`
            : userGuidDoToken(valor)
            ? `celular:${estruturaBase64(valor)}`
            : origem === "authorization-basic"
            ? "usuario-senha"
            : `desconhecido:${estruturaBase64(valor)}`;
      return `${origem}:${tipo}:len${valor.length}:${valor.slice(0, 4)}…`;
    })
    .join(",");
}

// Login por Authorization: Basic (usuario:senha), cacheado por alguns minutos.
const sessoesBasic = new Map<string, { jwt: string; expira: number }>();

async function jwtPorBasic(b64: string): Promise<string | null> {
  const c = sessoesBasic.get(b64);
  if (c && c.expira - Date.now() > 5 * 60_000) return c.jwt;
  let texto = "";
  try {
    texto = decodificarBase64(b64);
  } catch {
    return null;
  }
  const i = texto.indexOf(":");
  if (i <= 0) return null;
  const email = texto.slice(0, i).trim();
  const senha = texto.slice(i + 1);
  const { createClient } = await import("@supabase/supabase-js");
  const { supabaseUrlServidor, supabasePublishableKeyServidor } = await import(
    "@/integrations/supabase/config.server"
  );
  const cli = createClient(supabaseUrlServidor(), supabasePublishableKeyServidor()!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data } = await cli.auth.signInWithPassword({ email, password: senha });
  if (!data.session) return null;
  sessoesBasic.set(b64, { jwt: data.session.access_token, expira: (data.session.expires_at ?? 0) * 1000 });
  return data.session.access_token;
}

// Token do Gear de longa duração (os apps guardam o userToken e não refazem login).
// Formato: gear.<corpo>.<assinatura>, assinado com MEDIA_TOKEN_SECRET.
const VALIDADE_GEAR_S = 365 * 24 * 3600;

function segredoGear() {
  const s = process.env["MEDIA_TOKEN_SECRET"];
  if (!s) throw new Error("MEDIA_TOKEN_SECRET não configurado");
  return s;
}

export async function emitirTokenGear(userId: string) {
  const { createHmac } = await import("crypto");
  const corpo = Buffer.from(
    JSON.stringify({ u: userId, exp: Math.floor(Date.now() / 1000) + VALIDADE_GEAR_S }),
  ).toString("base64url");
  const sig = createHmac("sha256", "gear:" + segredoGear()).update(corpo).digest("base64url");
  return `gear.${corpo}.${sig}`;
}

async function lerTokenGear(token: string): Promise<string | null> {
  const p = token.split(".");
  if (p.length !== 3 || p[0] !== "gear") return null;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const esperada = createHmac("sha256", "gear:" + segredoGear()).update(p[1]!).digest("base64url");
  const a = Buffer.from(p[2]!);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p[1]!, "base64url").toString("utf8"));
    if (typeof d.u !== "string" || typeof d.exp !== "number" || d.exp < Date.now() / 1000) return null;
    return d.u;
  } catch {
    return null;
  }
}

// Sessão real do usuário (RLS) gerada no servidor e reaproveitada até perto de vencer.
const sessoesGear = new Map<string, { jwt: string; expira: number }>();

async function jwtDoUsuario(userId: string): Promise<string | null> {
  const c = sessoesGear.get(userId);
  if (c && c.expira - Date.now() > 5 * 60_000) return c.jwt;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (!email) return null;
  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  const hash = link?.properties?.hashed_token;
  if (error || !hash) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const { supabaseUrlServidor, supabasePublishableKeyServidor } = await import(
    "@/integrations/supabase/config.server"
  );
  const cli = createClient(supabaseUrlServidor(), supabasePublishableKeyServidor()!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: s } = await cli.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (!s.session) return null;
  sessoesGear.set(userId, { jwt: s.session.access_token, expira: (s.session.expires_at ?? 0) * 1000 });
  return s.session.access_token;
}

/** App do celular (Tecnorise): base64 de {"userGuid":"{UUID}"} — devolve o UUID ou null. */
function userGuidDoToken(valor: string): string | null {
  if (valor.includes(".")) return null;
  try {
    const texto = decodificarBase64(valor);
    if (!texto.trim().startsWith("{")) return null;
    // Leitura tolerante: o app pode mandar JSON levemente fora do padrão.
    const m = texto.match(/userguid"?\s*:\s*"?\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!m) return null;
    const id = m[1]!.toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// Acesso do celular só vale se o mesmo usuário fez login válido pouco antes,
// a partir do mesmo IP. Depois disso o acesso fica vinculado (por hash) e
// segue valendo mesmo se o IP mudar. Guardado em memória: reiniciar exige novo login.
const JANELA_LOGIN_MS = 10 * 60_000;
const VALIDADE_VINCULO_MS = 30 * 24 * 3600_000;
const loginsRecentes = new Map<string, { userId: string; expira: number }[]>();
const vinculosCelular = new Map<string, { userId: string; expira: number }>();

export function ipCliente(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "sem-ip"
  );
}

async function hashTexto(t: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Chamado pelo /api/login após senha aceita. */
export function registrarLoginGear(request: Request, userId: string) {
  const ip = ipCliente(request);
  const agora = Date.now();
  const lista = (loginsRecentes.get(ip) ?? []).filter((l) => l.expira > agora && l.userId !== userId);
  lista.push({ userId, expira: agora + JANELA_LOGIN_MS });
  loginsRecentes.set(ip, lista.slice(-20));
}

/** Situação do acesso do celular, para o log. */
export let ultimoMotivoCelular = "";

async function validarAcessoCelular(request: Request, token: string, userGuid: string): Promise<boolean> {
  const agora = Date.now();
  const h = await hashTexto(token);
  const v = vinculosCelular.get(h);
  if (v && v.expira > agora && v.userId === userGuid) {
    v.expira = agora + VALIDADE_VINCULO_MS;
    ultimoMotivoCelular = "vinculado";
    return true;
  }
  const ip = ipCliente(request);
  const lista = (loginsRecentes.get(ip) ?? []).filter((l) => l.expira > agora);
  if (!lista.some((l) => l.userId === userGuid)) {
    ultimoMotivoCelular = "sem-login-recente";
    return false;
  }
  vinculosCelular.set(h, { userId: userGuid, expira: agora + VALIDADE_VINCULO_MS });
  ultimoMotivoCelular = "vinculado-agora";
  console.info(`[gear-auth] acesso do celular vinculado ao usuário ${userGuid} ip=${ip}`);
  return true;
}

// Lista de acessos do celular no banco (tela API de integração). Cache curto
// para não consultar o banco a cada foto; atualiza "último uso" no máximo 1x/min.
const cacheCelular = new Map<string, { userId: string | null; ate: number; gravado: number }>();

async function acessoCelularDoBanco(request: Request, token: string, h: string): Promise<string | null> {
  const agora = Date.now();
  const c = cacheCelular.get(h);
  if (c && c.ate > agora) return c.userId;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("gear_acessos_celular")
    .select("status, user_id, pedidos")
    .eq("hash", h)
    .maybeSingle();
  const userId = data?.status === "liberado" ? data.user_id : null;
  const ip = ipCliente(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 200);
  const dvr = new URL(request.url).pathname.match(/servers\/([^/]+)/)?.[1]?.slice(0, 60) ?? null;
  if (!c || agora - c.gravado > 60_000) {
    if (data) {
      await supabaseAdmin
        .from("gear_acessos_celular")
        .update({ ultimo_visto: new Date().toISOString(), pedidos: (data.pedidos ?? 0) + 1, ip, ua, ultimo_dvr: dvr ? decodeURIComponent(dvr) : null })
        .eq("hash", h);
    } else {
      let dados = "";
      try {
        dados = decodificarBase64(token.split(".")[0] ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
      } catch {
        dados = "";
      }
      await supabaseAdmin
        .from("gear_acessos_celular")
        .upsert({ hash: h, dados, ip, ua, ultimo_dvr: dvr ? decodeURIComponent(dvr) : null, pedidos: 1 }, { onConflict: "hash", ignoreDuplicates: true });
    }
  }
  cacheCelular.set(h, { userId, ate: agora + (userId ? 60_000 : 15_000), gravado: !c || agora - c.gravado > 60_000 ? agora : c.gravado });
  return userId;
}

function acessosCelularLiberados(): Map<string, string> {
  const m = new Map<string, string>();
  for (const par of (process.env["GEAR_TOKENS_CELULAR"] ?? "").split(",")) {
    const [h, u] = par.split("=").map((x) => x?.trim().toLowerCase().replace(/[{}]/g, ""));
    if (h && u && /^[0-9a-f]{64}$/.test(h) && /^[0-9a-f-]{36}$/.test(u)) m.set(h, u);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Formato D-Guard real (o mesmo do adaptador que funciona no app):
// userToken = base64url({"userName":"..."}) + "." + base64url(HMAC-SHA256)
// ---------------------------------------------------------------------------
const chaveDg = () => "gear-dg:" + segredoGear();

export async function emitirTokenDGuard(userName: string) {
  const { createHmac } = await import("crypto");
  const dados = Buffer.from(JSON.stringify({ userName })).toString("base64url");
  const sig = createHmac("sha256", chaveDg()).update(dados).digest("base64url");
  return `${dados}.${sig}`;
}

function userNameDoToken(token: string): string | null {
  try {
    const d = JSON.parse(decodificarBase64(token.split(".")[0] ?? "")) as { userName?: unknown };
    return typeof d.userName === "string" && d.userName.trim() ? d.userName.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function assinaturaDGuardValida(token: string): Promise<boolean> {
  const [dados, sig] = token.split(".");
  if (!dados || !sig) return false;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const a = Buffer.from(sig);
  const b = Buffer.from(createHmac("sha256", chaveDg()).update(dados).digest("base64url"));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve o usuário Sentinela pelo login do Gear: e-mail completo, ou o nome antes do @ (se único). */
export async function usuarioPorLogin(login: string): Promise<{ id: string; email: string } | null> {
  const l = login.trim().toLowerCase();
  if (!l || l.length > 255) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const q = supabaseAdmin.from("profiles").select("id, email, ativo");
  const { data } = l.includes("@")
    ? await q.ilike("email", l.replace(/[%_]/g, "\\$&")).limit(2)
    : await q.ilike("email", `${l.replace(/[%_]/g, "\\$&")}@%`).limit(2);
  if (!data || data.length !== 1 || data[0]!.ativo === false) return null;
  return { id: data[0]!.id, email: data[0]!.email };
}

// Login recente por usuário (qualquer IP): permite vincular o token do celular
// que traz o mesmo userName logo após o login com senha.
const loginsPorUsuario = new Map<string, number>();
export function registrarLoginPorUsuario(userId: string) {
  loginsPorUsuario.set(userId, Date.now() + 30 * 60_000);
}

async function usuarioDoTokenDGuard(request: Request, token: string, h: string): Promise<string | null> {
  const nome = userNameDoToken(token);
  if (!nome) return null;
  const u = await usuarioPorLogin(nome);
  if (!u) {
    console.info(`[gear-auth] token D-Guard userName=${nome} sem usuario Sentinela correspondente`);
    return null;
  }
  if (await assinaturaDGuardValida(token)) return u.id; // emitido por nós
  // Assinado por terceiro: só vincula se o MESMO usuário fez login com senha há pouco.
  if ((loginsPorUsuario.get(u.id) ?? 0) < Date.now()) {
    console.info(`[gear-auth] token D-Guard userName=${nome} sem login recente desse usuario`);
    return null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("gear_acessos_celular").upsert(
    {
      hash: h,
      dados: `{"userName":"${nome}"}`,
      status: "liberado",
      user_id: u.id,
      liberado_em: new Date().toISOString(),
      ip: ipCliente(request),
      ua: (request.headers.get("user-agent") ?? "").slice(0, 200),
    },
    { onConflict: "hash" },
  );
  cacheCelular.delete(h);
  console.info(`[gear-auth] token do celular vinculado automaticamente a ${nome}`);
  return u.id;
}

export async function usuarioGear(request: Request) {
  const cand = extrairToken(request);
  if (!cand) return { erro: jsonGear({ error: "Unauthorized" }, 401) };
  let token = cand.valor.replace(/^"|"$/g, "");
  const userGuid = userGuidDoToken(token);
  if (token.split(".").length === 2) {
    // Só aceita o acesso emitido pelo nosso login (e-mail e senha), com assinatura válida.
    const h = await hashTexto(token);
    const nome = userNameDoToken(token);
    const userId =
      nome && (await assinaturaDGuardValida(token)) ? ((await usuarioPorLogin(nome))?.id ?? null) : null;
    if (!userId) {
      console.info(`[gear-auth] acesso do celular recusado/aguardando liberacao hash=${h.slice(0, 12)}`);
      return { erro: jsonGear({ error: "Unauthorized" }, 401) };
    }
    const jwt = await jwtDoUsuario(userId);
    if (!jwt) return { erro: jsonGear({ error: "Unauthorized" }, 401) };
    token = jwt;
  } else if (userGuid && !(await validarAcessoCelular(request, token, userGuid))) {
    return { erro: jsonGear({ error: "Unauthorized" }, 401) };
  }
  else if (token.startsWith("gear.") || userGuid) {
    // userGuid: app do celular manda só o userGuid do login; a sessão real
    // do usuário continua aplicando as permissões (RLS) dele.
    const userId = userGuid ?? (await lerTokenGear(token));
    const jwt = userId ? await jwtDoUsuario(userId) : null;
    if (!jwt) return { erro: jsonGear({ error: "Unauthorized" }, 401) };
    token = jwt;
  } else if (cand.origem === "authorization-basic" || token.split(".").length !== 3) {
    // App que manda usuário:senha (Basic) em vez do userToken.
    const jwt = await jwtPorBasic(token).catch(() => null);
    if (!jwt) return { erro: jsonGear({ error: "Unauthorized" }, 401) };
    token = jwt;
  }
  const { exigirUsuario } = await import("@/lib/api-publica.server");
  const req = new Request(request.url, { headers: { authorization: `Bearer ${token}` } });
  const r = await exigirUsuario(req);
  if ("erro" in r && r.erro) return { erro: jsonGear({ error: "Unauthorized" }, r.erro.status) };
  return { auth: r.auth! };
}

export const uuid = z.string().uuid();

/** DVR visível ao usuário (RLS) ou null. */
export async function dvrDoUsuario(
  client: SupabaseClient<Database>,
  guid: string,
) {
  if (!uuid.safeParse(guid).success) return null;
  const { data } = await client
    .from("dvrs")
    .select("id, nome, canais, online, ativo")
    .eq("id", guid)
    .maybeSingle();
  return data;
}
