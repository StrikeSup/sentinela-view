// Snapshot JPEG para o Gear: 1) Agent do servidor onde o DVR roda, 2) DVR direto pelo IP externo.
// Nunca converte vídeo. Server-only.
import { createHash } from "node:crypto";

type Dvr = {
  id: string;
  fabricante: string | null;
  ip_externo: string | null;
  porta_http_externa: number | null;
  usuario: string | null;
  senha: string | null;
  servidor_id: string | null;
};

const TEMPO = 6000;
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

async function jpeg(res: Response): Promise<ArrayBuffer | null> {
  const tipo = res.headers.get("content-type") ?? "";
  if (!res.ok || !tipo.includes("image")) return null;
  const buf = await res.arrayBuffer();
  return buf.byteLength > 100 ? buf : null;
}

async function viaAgent(dvr: Dvr, canal: number, stream: number, w: number, h: number, baseServidor: string | null) {
  const base = (baseServidor || process.env["AGENT_SNAPSHOT_BASE"] || "").trim();
  if (!base) return null;
  try {
    const u = new URL(base.replace(/\/+$/, "") + "/snapshot");
    u.searchParams.set("dvr_id", dvr.id);
    u.searchParams.set("canal", String(canal));
    u.searchParams.set("width", String(w));
    u.searchParams.set("height", String(h));
    u.searchParams.set("stream", stream === 1 ? "extra" : "main");
    u.searchParams.set("subtype", String(stream));
    const headers: Record<string, string> = {};
    const t = process.env["AGENT_SNAPSHOT_TOKEN"];
    if (t) headers["authorization"] = `Bearer ${t}`;
    return await jpeg(await fetch(u, { headers, signal: AbortSignal.timeout(TEMPO) }));
  } catch {
    return null;
  }
}

/** stream 0 = principal (Hik x01 / Dahua subtype=0), 1 = extra (Hik x02 / Dahua subtype=1). */
function caminhoFabricante(fab: string | null, canal: number, stream: number) {
  return /hikvision/i.test(fab ?? "")
    ? `/ISAPI/Streaming/channels/${canal}0${stream + 1}/picture`
    : `/cgi-bin/snapshot.cgi?channel=${canal}&subtype=${stream}`;
}

/** GET com autenticação Digest (com retorno para Basic). */
async function getDigest(url: string, usuario: string, senha: string) {
  const r1 = await fetch(url, { signal: AbortSignal.timeout(TEMPO) });
  if (r1.status !== 401) return r1;
  const desafio = r1.headers.get("www-authenticate") ?? "";
  if (!/^digest/i.test(desafio)) {
    return fetch(url, {
      headers: { authorization: "Basic " + btoa(`${usuario}:${senha}`) },
      signal: AbortSignal.timeout(TEMPO),
    });
  }
  const p = (k: string) => desafio.match(new RegExp(`${k}="?([^",]+)"?`, "i"))?.[1];
  const realm = p("realm") ?? "";
  const nonce = p("nonce") ?? "";
  const qop = p("qop")?.split(",")[0]?.trim();
  const opaque = p("opaque");
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const nc = "00000001";
  const cnonce = md5(String(Math.random())).slice(0, 16);
  const ha1 = md5(`${usuario}:${realm}:${senha}`);
  const ha2 = md5(`GET:${uri}`);
  const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  let auth = `Digest username="${usuario}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}"`;
  if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) auth += `, opaque="${opaque}"`;
  return fetch(url, { headers: { authorization: auth }, signal: AbortSignal.timeout(TEMPO) });
}

async function viaDvrDireto(dvr: Dvr, canal: number, stream: number) {
  if (!dvr.ip_externo || !dvr.porta_http_externa || !dvr.usuario) return null;
  try {
    const url = `http://${dvr.ip_externo}:${dvr.porta_http_externa}${caminhoFabricante(dvr.fabricante, canal, stream)}`;
    return await jpeg(await getDigest(url, dvr.usuario, dvr.senha ?? ""));
  } catch {
    return null;
  }
}

/** Busca o JPEG real; null quando nenhuma origem respondeu. */
export async function buscarSnapshot(dvrId: string, canal: number, w: number, h: number, stream = 0) {
  // 0) Foto enviada pelo Agent (PUSH). Registra o pedido para o próximo heartbeat.
  const { lerSnapshot, solicitarSnapshot } = await import("./snapshot-cache.server");
  solicitarSnapshot(dvrId, canal);
  const push = lerSnapshot(dvrId, canal, undefined, stream);
  if (push) return push;
  // Quadro um pouco antigo (até 5 min): entrega já, sem esperar DVR/Agent. O pedido acima
  // faz o Agent mandar uma foto nova, que o próximo acesso do app recebe.
  const reserva = lerSnapshot(dvrId, canal, 5 * 60_000, stream);
  if (reserva) return reserva;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: dvr } = await supabaseAdmin
    .from("dvrs")
    .select("id, fabricante, ip_externo, porta_http_externa, usuario, senha, servidor_id")
    .eq("id", dvrId)
    .maybeSingle();
  if (!dvr) return null;
  let baseServidor: string | null = null;
  if (dvr.servidor_id) {
    const { data: s } = await supabaseAdmin
      .from("servidores")
      .select("base_url")
      .eq("id", dvr.servidor_id)
      .maybeSingle();
    baseServidor = s?.base_url ?? null;
  }
  const { aguardarSnapshot } = await import("./snapshot-cache.server");
  return (
    (await viaAgent(dvr, canal, stream, w, h, baseServidor)) ??
    (await viaDvrDireto(dvr, canal, stream)) ??
    (await aguardarSnapshot(dvrId, canal, 6000, stream))
  );
}
