import { describe, it, expect } from "vitest";
import { resolverImagem, type DepsImagem, type SessaoPub, PROBE_RAPIDO_MS } from "./imagem-fluxo";
import type { ResultadoPlaylist } from "./hls-prontidao";

const OK: ResultadoPlaylist = { pronta: true, status: 200 };
const E404: ResultadoPlaylist = { pronta: false, status: 404, motivo: "http_erro" };

function fake(opts: {
  sessoes?: (SessaoPub & { criada: number })[];
  probe?: (n: number) => ResultadoPlaylist;
  /** estado que o "Agent" aplica após N leituras */
  agentePublicaApos?: number;
}) {
  let relogio = 1_000_000;
  let seq = 0;
  let probes = 0;
  let leituras = 0;
  const db: (SessaoPub & { criada: number })[] = opts.sessoes ?? [];
  const probeTimeouts: number[] = [];
  const deps: DepsImagem = {
    ativas: async () => {
      await Promise.resolve();
      return db
        .filter(
          (s) =>
            ["solicitada", "conectando", "publicando"].includes(s.estado) &&
            new Date(s.expires_at).getTime() > relogio,
        )
        .sort((a, b) => a.criada - b.criada)
        .slice(0, 1)
        .map(({ criada: _c, ...s }) => s);
    },
    renovar: async (id, e) => {
      const s = db.find((x) => x.id === id);
      if (s) s.expires_at = e;
    },
    criar: async (path, e) => {
      await Promise.resolve();
      const s = { id: `s${++seq}`, estado: "solicitada", path, expires_at: e, criada: seq };
      db.push(s);
      return { id: s.id, estado: s.estado, path, expires_at: e };
    },
    encerrar: async (id) => {
      const s = db.find((x) => x.id === id);
      if (s) s.estado = "encerrada";
    },
    ler: async (id) => {
      leituras++;
      const s = db.find((x) => x.id === id);
      if (s && opts.agentePublicaApos !== undefined && leituras > opts.agentePublicaApos)
        s.estado = "publicando";
      return s ? { ...s } : null;
    },
    probe: async (_id, _p, t) => {
      probeTimeouts.push(t);
      return (opts.probe ?? (() => OK))(++probes);
    },
    links: (id, p) => ({ hls_url: `https://h/${p}?sid=${id}`, whep_url: `https://w/${p}` }),
    novoPath: () => `sv_${String(++seq).padStart(18, "0")}`,
    agora: () => relogio,
    dormir: async (ms) => {
      relogio += ms;
    },
  };
  return {
    deps,
    db,
    probeTimeouts,
    get probes() {
      return probes;
    },
  };
}

const ativa = (estado: string, expiraEm = "2099-01-01T00:00:00Z") => ({
  id: "a1",
  estado,
  path: "sv_aaaaaaaaaaaaaaaaaa",
  expires_at: expiraEm,
  criada: 0,
});

describe("resolverImagem", () => {
  it("publicando + playlist válida => 200 publicando midia_pronta", async () => {
    const f = fake({ sessoes: [ativa("publicando")] });
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      estado: "publicando",
      midia_pronta: true,
      etapa: "playlist_hls_pronta",
    });
  });

  it("playlist 404 persistente => 202 preparando com status e diagnóstico", async () => {
    const f = fake({ sessoes: [ativa("publicando")], probe: () => E404 });
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({
      estado: "preparando",
      midia_pronta: false,
      etapa: "aguardando_playlist_hls",
      status_playlist: 404,
    });
    expect(String(r.body["diagnostico"])).toContain("404");
  });

  it("transição: 500 depois 404 depois pronta => 200", async () => {
    const seq: ResultadoPlaylist[] = [
      { pronta: false, status: 500, motivo: "http_erro" },
      E404,
      OK,
    ];
    const f = fake({ sessoes: [ativa("publicando")], probe: (n) => seq[n - 1]! });
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r.status).toBe(200);
    expect(f.probes).toBe(3);
  });

  it("partida fria: aguarda Agent publicar e playlist ficar pronta", async () => {
    const f = fake({ agentePublicaApos: 2 });
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r.status).toBe(200);
    expect(f.db).toHaveLength(1);
  });

  it("Agent nunca publica => 202 aguardando_agent", async () => {
    const f = fake({});
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r).toMatchObject({
      status: 202,
      body: { etapa: "aguardando_agent", midia_pronta: false },
    });
    expect(f.probes).toBe(0);
  });

  it("aguardar=nao em partida fria: sem probe, 202 preparando com links", async () => {
    const f = fake({});
    const r = await resolverImagem(f.deps, { semEspera: true });
    expect(r.status).toBe(202);
    expect(r.body["url_video"]).toBeTruthy();
    expect(f.probes).toBe(0);
  });

  it("aguardar=nao em publicação existente usa probe curto", async () => {
    const f = fake({ sessoes: [ativa("publicando")], probe: () => E404 });
    const r = await resolverImagem(f.deps, { semEspera: true });
    expect(r.status).toBe(202);
    expect(f.probeTimeouts).toEqual([PROBE_RAPIDO_MS]);
    const g = fake({ sessoes: [ativa("publicando")] });
    expect((await resolverImagem(g.deps, { semEspera: true })).status).toBe(200);
  });

  it("renova a validade da sessão existente", async () => {
    const f = fake({ sessoes: [ativa("publicando", "1970-01-01T00:20:00Z")] });
    const r = await resolverImagem(f.deps, { semEspera: false });
    expect(r.status).toBe(200);
    expect(new Date(f.db[0]!.expires_at).getTime()).toBe(1_000_000 + 300_000);
  });

  it("sessão expirada não é reaproveitada: cria nova", async () => {
    const f = fake({ sessoes: [ativa("publicando", "1970-01-01T00:00:01Z")] });
    await resolverImagem(f.deps, { semEspera: true });
    expect(f.db).toHaveLength(2);
    expect(f.db[0]!.expires_at).toBe("1970-01-01T00:00:01Z");
  });

  it("Agent reporta erro => 502", async () => {
    const f = fake({ sessoes: [{ ...ativa("conectando"), estado: "erro" }] });
    f.db[0]!.estado = "conectando";
    const orig = f.deps.ler;
    f.deps.ler = async (id) => ({ ...(await orig(id))!, estado: "erro", diagnostico: "x" });
    expect((await resolverImagem(f.deps, { semEspera: false })).status).toBe(502);
  });

  it("duas chamadas simultâneas à mesma câmera deixam uma só sessão ativa", async () => {
    const f = fake({});
    const [a, b] = await Promise.all([
      resolverImagem(f.deps, { semEspera: true }),
      resolverImagem(f.deps, { semEspera: true }),
    ]);
    const vivas = f.db.filter((s) => s.estado !== "encerrada");
    expect(vivas).toHaveLength(1);
    expect(a.body["url_video"]).toBe(b.body["url_video"]);
  });
});
