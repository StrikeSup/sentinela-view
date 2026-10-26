import { describe, expect, it } from "vitest";
import { corrigirDestinoIce, diagnosticarCandidatosIce, listarCandidatos } from "./ice-sdp";

const config = { host_publico: "177.117.146.20", porta_udp: 45000 };

const sdp = (linhas: string[]) =>
  ["v=0", "o=- 1 1 IN IP4 0.0.0.0", "c=IN IP4 172.16.0.125", "m=video 9 UDP/TLS/RTP/SAVPF 96", ...linhas].join(
    "\r\n",
  ) + "\r\n";

const LAN = "a=candidate:1 1 udp 2130706431 192.168.1.10 45000 typ host";
const VPN = "a=candidate:2 1 udp 2130706430 172.16.0.125 45000 typ host";
const PUB = "a=candidate:3 1 udp 1694498815 177.117.146.20 45000 typ srflx raddr 0.0.0.0 rport 0";

describe("corrigirDestinoIce", () => {
  it("preserva candidato LAN intacto", () => {
    const s = sdp([LAN]);
    expect(corrigirDestinoIce(s, config)).toBe(s);
  });
  it("preserva candidato VPN intacto e a linha c=", () => {
    const s = sdp([VPN]);
    const r = corrigirDestinoIce(s, config)!;
    expect(r).toContain(VPN);
    expect(r).toContain("c=IN IP4 172.16.0.125");
  });
  it("não perde nenhum candidato com LAN + VPN + público", () => {
    const s = sdp([LAN, VPN, PUB]);
    const r = corrigirDestinoIce(s, config);
    expect(listarCandidatos(r)).toHaveLength(3);
    expect(r).toBe(s);
  });
  it("não inventa candidato público", () => {
    const r = corrigirDestinoIce(sdp([VPN]), config)!;
    expect(r).not.toContain("177.117.146.20");
  });
});

describe("diagnosticarCandidatosIce", () => {
  it("aponta ausência do endereço público sem expor IP privado", () => {
    const d = diagnosticarCandidatosIce(sdp([LAN, VPN]), config)!;
    expect(d).toContain("2 candidato(s) privado(s)");
    expect(d).not.toContain("172.16");
    expect(d).not.toContain("192.168");
  });
  it("sem diagnóstico quando o público está anunciado", () => {
    expect(diagnosticarCandidatosIce(sdp([VPN, PUB]), config)).toBeNull();
  });
  it("aponta answer sem candidatos", () => {
    expect(diagnosticarCandidatosIce(sdp([]), config)).toMatch(/sem candidatos/);
  });
});
