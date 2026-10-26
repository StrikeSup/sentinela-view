// Fluxo do GET /api/public/v1/imagem, isolado das dependências para ser testável.
// Contrato público: sucesso = HTTP 200 + estado "publicando" (inalterado), agora
// só depois da playlist HLS útil ser confirmada no MediaMTX (midia_pronta: true).
// Enquanto isso: HTTP 202 + estado "preparando" + midia_pronta: false.
// Obs.: a checagem prova a playlist HLS; não prova WHEP nem quadro no player.
import { diagnosticoPlaylist, type ResultadoPlaylist } from "./hls-prontidao";

export type SessaoPub = {
  id: string;
  estado: string;
  path: string;
  expires_at: string;
  diagnostico?: string | null;
};

export type DepsImagem = {
  /** Sessões de publicação ativas da câmera, da mais antiga para a mais nova. */
  ativas(): Promise<SessaoPub[]>;
  renovar(id: string, expiraEm: string): Promise<void>;
  criar(path: string, expiraEm: string): Promise<SessaoPub | null>;
  encerrar(id: string): Promise<void>;
  ler(id: string): Promise<SessaoPub | null>;
  probe(id: string, path: string, timeoutMs: number): Promise<ResultadoPlaylist>;
  links(
    id: string,
    path: string,
    expiraEm: string,
  ): { hls_url: string | null; whep_url: string | null };
  novoPath(): string;
  agora(): number;
  dormir(ms: number): Promise<void>;
};

export const VALIDADE_SEGUNDOS = 300;
export const ESPERA_MAX_MS = 20_000;
export const PROBE_MS = 1500;
/** aguardar=nao em publicação existente: probe curto (custo máx. ~300 ms). */
export const PROBE_RAPIDO_MS = 300;
const INTERVALO_MS = 400;

export type RespostaImagem = { status: number; body: Record<string, unknown> };

export async function resolverImagem(
  deps: DepsImagem,
  opts: { semEspera: boolean },
): Promise<RespostaImagem> {
  const expira = new Date(deps.agora() + VALIDADE_SEGUNDOS * 1000).toISOString();

  const base = (s: { id: string; path: string }, expiraEm: string) => {
    const { hls_url, whep_url } = deps.links(s.id, s.path, expiraEm);
    return { tipo: "hls", url_video: hls_url, url_webrtc_whep: whep_url, expira_em: expiraEm };
  };
  const pronto = (s: SessaoPub, expiraEm: string): RespostaImagem => ({
    status: 200,
    body: {
      ...base(s, expiraEm),
      estado: "publicando",
      midia_pronta: true,
      etapa: "playlist_hls_pronta",
      observacao: "Chame novamente antes de expirar para manter o vídeo ativo.",
    },
  });
  const preparando = (
    s: SessaoPub,
    expiraEm: string,
    etapa: string,
    pl: ResultadoPlaylist | null,
  ): RespostaImagem => ({
    status: 202,
    body: {
      ...base(s, expiraEm),
      estado: "preparando",
      midia_pronta: false,
      etapa,
      diagnostico: pl ? diagnosticoPlaylist(pl) : null,
      status_playlist: pl && !pl.pronta ? pl.status : null,
      observacao: "Vídeo sendo preparado; o link passa a tocar em alguns segundos.",
    },
  });

  let sessao: SessaoPub;
  const [existente] = await deps.ativas();
  if (existente) {
    await deps.renovar(existente.id, expira);
    sessao = { ...existente, expires_at: expira };
    if (existente.estado === "publicando") {
      const pl = await deps.probe(
        sessao.id,
        sessao.path,
        opts.semEspera ? PROBE_RAPIDO_MS : PROBE_MS,
      );
      if (pl.pronta) return pronto(sessao, expira);
      if (opts.semEspera) return preparando(sessao, expira, "aguardando_playlist_hls", pl);
    } else if (opts.semEspera) {
      return preparando(sessao, expira, "aguardando_agent", null);
    }
  } else {
    const criada = await deps.criar(deps.novoPath(), expira);
    if (!criada) return { status: 500, body: { erro: "Falha ao solicitar o vídeo." } };
    sessao = criada;
    // Corrida: duas chamadas simultâneas podem criar duas sessões. Fica a mais
    // antiga; a nossa é encerrada, então a câmera nunca tem duas publicações.
    const [vencedora] = await deps.ativas();
    if (vencedora && vencedora.id !== criada.id) {
      await deps.encerrar(criada.id);
      await deps.renovar(vencedora.id, expira);
      sessao = { ...vencedora, expires_at: expira };
    }
    // Partida fria com aguardar=nao: sem probe, responde na hora.
    if (opts.semEspera) return preparando(sessao, expira, "aguardando_agent", null);
  }

  const limite = deps.agora() + ESPERA_MAX_MS;
  let ultimo: ResultadoPlaylist | null = null;
  while (true) {
    const s = await deps.ler(sessao.id);
    if (!s) return { status: 500, body: { erro: "Falha ao solicitar o vídeo." } };
    if (s.estado === "erro" || s.estado === "encerrada")
      return {
        status: 502,
        body: { erro: s.diagnostico ?? "Vídeo ao vivo indisponível para esta câmera." },
      };
    if (s.estado === "publicando") {
      ultimo = await deps.probe(s.id, s.path, PROBE_MS);
      if (ultimo.pronta) return pronto(s, s.expires_at);
    }
    if (deps.agora() > limite)
      return {
        ...preparando(
          s,
          s.expires_at,
          s.estado === "publicando" ? "aguardando_playlist_hls" : "aguardando_agent",
          ultimo,
        ),
      };
    await deps.dormir(INTERVALO_MS);
  }
}
