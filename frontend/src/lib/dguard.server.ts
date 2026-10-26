// Helpers do contrato D-Guard (Gear) no Sentinela. Server-only.

/** UUID do Sentinela -> GUID do Gear: {UUID-MAIUSCULO} */
export function guidDeUuid(uuid: string): string {
  return "{" + uuid.toUpperCase() + "}";
}

/** GUID do Gear (com/sem chaves e hifens) -> UUID minúsculo com hifens, ou null. */
export function uuidDoGuid(guid: string): string | null {
  const h = decodeURIComponent(guid).replace(/[{}\-\s]/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** GUID estável (estilo UUID v5, SHA-256). */
export async function guidEstavel(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  const b = new Uint8Array(digest);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  return guidDeUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
  );
}

export function dataHoraServidor(): { serverDate: string; serverTime: string } {
  const a = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    serverDate: `${a.getFullYear()}-${p(a.getMonth() + 1)}-${p(a.getDate())}`,
    serverTime: `${p(a.getHours())}:${p(a.getMinutes())}:${p(a.getSeconds())}`,
  };
}

/**
 * Todos os canais do DVR (1..canais), ordenados; o índice (0..N) é o id do Gear.
 * A tabela de câmeras só tem os canais que o Agent já reportou, então canais sem
 * registro entram como "Canal N" — o Gear mostra todas as câmeras do DVR.
 */
export async function camerasOrdenadas(client: any, dvrId: string) {
  const [{ data, error }, { data: dvr }] = await Promise.all([
    client.from("cameras").select("id, nome, canal, online").eq("dvr_id", dvrId).order("canal"),
    client.from("dvrs").select("canais").eq("id", dvrId).maybeSingle(),
  ]);
  type Cam = { id: string; nome: string; canal: number; online: boolean };
  const lista = (data ?? []) as Cam[];
  const porCanal = new Map(lista.map((c) => [c.canal, c]));
  const total = Math.max(Number(dvr?.canais) || 0, ...lista.map((c) => c.canal), 0);
  const cameras: Cam[] = Array.from({ length: total }, (_, i) => {
    const canal = i + 1;
    return porCanal.get(canal) ?? { id: `${dvrId}:${canal}`, nome: `Canal ${canal}`, canal, online: false };
  });
  return { cameras, error };
}

/** DVR visível ao usuário (RLS) a partir do GUID do Gear. */
export async function dvrPorGuid(client: any, guid: string) {
  const id = uuidDoGuid(guid);
  if (!id) return null;
  const { data } = await client.from("dvrs").select("id, nome, online, ativo").eq("id", id).maybeSingle();
  return data as { id: string; nome: string; online: boolean; ativo: boolean } | null;
}

/** Imagem real da câmera índice camId (Agent ou DVR direto); 404 quando indisponível. */
/** Stream do Gear: 0 = principal (main), 1 = extra/secundário. Padrão: principal. */
export function streamGear(valor: string | undefined): number {
  return String(valor ?? "").trim() === "1" ? 1 : 0;
}

export async function imagemGear(request: Request, guid: string, camId: string, w: number, h: number, streamParam?: string) {
  const stream = streamGear(streamParam);
  const { usuarioGear, jsonGear, CORS_GEAR, descreverToken } = await import("@/lib/gear-api.server");
  const inicio = Date.now();
  const ua = request.headers.get("user-agent") ?? "";
  const aparelho = /android|iphone|ipad|mobile|okhttp|dart|cfnetwork|darwin/i.test(ua) ? "CELULAR" : "COMPUTADOR";
  const acesso = descreverToken(request);
  const tokenTipo = acesso === "sem-token" ? "sem-token" : /:gear:/.test(acesso) ? "token-novo" : /:celular:|userGuid=guid/.test(acesso) ? "token-celular" : "token-antigo";
  const horario = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const log = (status: number, resultado: string) =>
    console.log(
      `[gear-imagem] v0610c ${horario} aparelho=${aparelho} status=${status} resultado="${resultado}" dvr=${guid} cam=${camId} stream=${stream === 1 ? "extra" : "principal"} tam=${w}x${h} ${tokenTipo} acesso=[${acesso}] tempo=${Date.now() - inicio}ms ua="${ua}" params="${[...new URL(request.url).searchParams.keys()].join(",")}"`,
    );
  try {
    const r = await usuarioGear(request);
    if (r.erro) {
      log(r.erro.status, tokenTipo === "sem-token" ? "ERRO: app não enviou o acesso (token)" : tokenTipo === "token-antigo" ? "ERRO: acesso antigo/vencido - refazer login" : tokenTipo === "token-celular" ? "ERRO: celular sem login recente - sair e entrar de novo no app" : "ERRO: acesso recusado");
      return r.erro;
    }
    const dvr = await dvrPorGuid(r.auth.client, guid);
    if (!dvr) {
      log(404, "ERRO: DVR não encontrado ou sem permissão para este usuário");
      return jsonGear({ error: "Server not found" }, 404);
    }
    const { cameras } = await camerasOrdenadas(r.auth.client, dvr.id);
    const idx = Number(camId);
    const cam = Number.isInteger(idx) ? cameras[idx] : undefined;
    if (!cam) {
      log(404, `ERRO: câmera ${camId} não existe (DVR tem ${cameras.length})`);
      return jsonGear({ error: "Camera not found" }, 404);
    }
    const { buscarSnapshot } = await import("@/lib/gear-snapshot.server");
    const img = await buscarSnapshot(dvr.id, cam.canal, w, h, stream);
    if (!img) {
      log(404, `ERRO: sem foto do Agent para ${dvr.nome} canal ${cam.canal} (Agent não enviou)`);
      return jsonGear({ error: "Camera unavailable" }, 404);
    }
    log(200, `OK ${dvr.nome} canal ${cam.canal} stream ${stream === 1 ? "extra" : "principal"} ${img.byteLength} bytes`);
    return new Response(img, {
      status: 200,
      headers: { ...CORS_GEAR, "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    log(500, `ERRO interno: ${(e as Error)?.message ?? e}`);
    return jsonGear({ error: "Internal error" }, 500);
  }
}
