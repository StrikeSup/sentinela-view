/**
 * Candidatos ICE do answer SDP.
 *
 * O SDP do Agent/MediaMTX é preservado intacto: candidatos host de LAN/VPN
 * (ex.: 172.16.0.125) são caminhos válidos e não podem ser sobrescritos, e
 * nenhum candidato público é inventado sem prova de que é alcançável. Quando o
 * endereço público configurado não aparece no answer, apenas registramos um
 * diagnóstico — o anúncio correto é responsabilidade do Agent/MediaMTX.
 */

export type CandidatoIce = {
  endereco: string;
  porta: number;
  tipo: string;
  protocolo: string;
  privado: boolean;
};

const PRIVADO =
  /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function enderecoPrivado(endereco: string): boolean {
  const e = endereco.toLowerCase();
  if (e === "::1" || e.startsWith("fe80:") || e.startsWith("fc") || e.startsWith("fd")) return true;
  return PRIVADO.test(e);
}

export function listarCandidatos(sdp: string | null): CandidatoIce[] {
  if (!sdp) return [];
  const lista: CandidatoIce[] = [];
  const re = /^a=candidate:\S+\s+\d+\s+(\S+)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sdp))) {
    const endereco = m[2]!;
    lista.push({
      protocolo: m[1]!.toLowerCase(),
      endereco,
      porta: Number(m[3]),
      tipo: m[4]!.toLowerCase(),
      privado: enderecoPrivado(endereco),
    });
  }
  return lista;
}

function lerConfig(config: unknown): { host: string; porta: number | null } | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const d = config as Record<string, unknown>;
  const host = typeof d["host_publico"] === "string" ? d["host_publico"].trim() : "";
  const porta = typeof d["porta_udp"] === "number" ? d["porta_udp"] : null;
  return host ? { host, porta } : null;
}

/**
 * Diagnóstico curto e sanitizado (sem IPs privados) dos candidatos do answer.
 * Devolve null quando não há nada a apontar.
 */
export function diagnosticarCandidatosIce(sdp: string | null, config: unknown): string | null {
  if (!sdp) return null;
  const cands = listarCandidatos(sdp);
  if (cands.length === 0) return "answer sem candidatos ICE (a=candidate ausente)";
  const cfg = lerConfig(config);
  if (!cfg) return null;
  const temPublico = cands.some(
    (c) => c.endereco === cfg.host && (cfg.porta === null || c.porta === cfg.porta),
  );
  if (temPublico) return null;
  const privados = cands.filter((c) => c.privado).length;
  return `answer sem o endereço público configurado; ${privados} candidato(s) privado(s) preservado(s). Configure webrtcAdditionalHosts no MediaMTX do servidor.`;
}

/**
 * Porta externa (redirecionamento no roteador) escolhida no painel.
 *
 * O Agent continua escutando na porta interna (ex.: 45000). Quando o servidor
 * tem uma porta externa diferente, ACRESCENTAMOS candidatos públicos com essa
 * porta — nada é removido, então a rede local segue tendo prioridade.
 */
export function corrigirDestinoIce(sdp: string | null, config?: unknown): string | null {
  if (!sdp || !config || typeof config !== "object") return sdp;
  const d = config as Record<string, unknown>;
  const externa = typeof d["porta_udp_externa"] === "number" ? d["porta_udp_externa"] : null;
  if (!externa || externa < 1 || externa > 65535) return sdp;
  const host = typeof d["host_publico"] === "string" ? d["host_publico"].trim() : "";

  const quebra = sdp.includes("\r\n") ? "\r\n" : "\n";
  const linhas = sdp.split(/\r?\n/);
  const saida: string[] = [];
  let extras: string[] = [];
  let existentes = new Set<string>();
  let seq = 0;
  const descarregar = () => {
    for (const e of extras) saida.push(e);
    extras = [];
  };
  const re = /^a=candidate:\S+\s+(\d+)\s+(\S+)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+\S+/i;
  for (const linha of linhas) {
    if (linha.startsWith("m=")) {
      descarregar();
      existentes = new Set();
    }
    if (linha.startsWith("a=end-of-candidates")) descarregar();
    const m = re.exec(linha);
    if (!m) {
      saida.push(linha);
      continue;
    }
    const [, comp, proto, end] = m;
    const publico = proto!.toLowerCase() === "udp" && (host ? end === host : !enderecoPrivado(end!));
    if (publico && Number(m[4]) !== externa) {
      // IP público com a porta interna não é alcançável de fora: troca pela externa.
      seq++;
      if (existentes.has(`${end}:${externa}`)) continue;
      existentes.add(`${end}:${externa}`);
      saida.push(linha.replace(new RegExp(`(\\s${end!.replace(/\./g, "\\.")}\\s+)${m[4]}(\\s)`), `$1${externa}$2`));
      continue;
    }
    existentes.add(`${end}:${m[4]}`);
    saida.push(linha);
    if (!publico || existentes.has(`${end}:${externa}`)) continue;
    existentes.add(`${end}:${externa}`);
    extras.push(`a=candidate:sx${++seq} ${comp} udp 1694498815 ${end} ${externa} typ srflx raddr 0.0.0.0 rport 0`);
  }
  // Agent não anunciou o IP público: usa o host público informado por ele.
  if (seq === 0 && host && !enderecoPrivado(host)) {
    const res: string[] = [];
    let emMidia = false;
    let posto = false;
    const fechar = () => {
      if (emMidia && !posto) res.push(`a=candidate:sx${++seq} 1 udp 1694498815 ${host} ${externa} typ srflx raddr 0.0.0.0 rport 0`);
    };
    for (const linha of saida) {
      if (linha.startsWith("m=")) {
        fechar();
        emMidia = true;
        posto = false;
      }
      if (emMidia && !posto && linha.startsWith("a=end-of-candidates")) {
        res.push(`a=candidate:sx${++seq} 1 udp 1694498815 ${host} ${externa} typ srflx raddr 0.0.0.0 rport 0`);
        posto = true;
      }
      res.push(linha);
    }
    // última mídia: insere antes da linha vazia final
    if (emMidia && !posto) {
      const ult = res.length && res[res.length - 1] === "" ? res.length - 1 : res.length;
      res.splice(ult, 0, `a=candidate:sx${++seq} 1 udp 1694498815 ${host} ${externa} typ srflx raddr 0.0.0.0 rport 0`);
    }
    return res.join(quebra);
  }
  descarregar();
  // extras da última mídia ficaram depois da linha vazia final; reposiciona
  const texto = saida.join(quebra);
  return texto.replace(new RegExp(`${quebra}${quebra}(a=candidate:sx[^]*)$`), `${quebra}$1${quebra}`);
}

/** Junta o que o Agent informou com a porta externa escolhida no painel. */
export function configIceServidor(
  servidor: { midia_webrtc?: unknown; porta_udp_externa?: number | null; ip?: string | null } | null | undefined,
): Record<string, unknown> | null {
  if (!servidor) return null;
  const base =
    servidor.midia_webrtc && typeof servidor.midia_webrtc === "object" && !Array.isArray(servidor.midia_webrtc)
      ? (servidor.midia_webrtc as Record<string, unknown>)
      : {};
  // Agent não anunciou o host público: usa o IP cadastrado do servidor.
  const hostInformado = typeof base["host_publico"] === "string" ? base["host_publico"].trim() : "";
  const host = hostInformado || (typeof servidor.ip === "string" ? servidor.ip.trim() : "");
  return { ...base, host_publico: host, porta_udp_externa: servidor.porta_udp_externa ?? null };
}
