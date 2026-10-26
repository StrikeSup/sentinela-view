import { describe, expect, it } from "vitest";
import { formatarHoraDvr, linhasTelemetriaDvr } from "./dvr-telemetria";

const agora = Date.parse("2026-10-07T18:13:00Z");

describe("telemetria do DVR", () => {
  it("online sem HD, hora local sem conversão", () => {
    const l = linhasTelemetriaDvr(
      { status_hd: "Nenhum HD detectado", data_hora_dvr: "2026-10-07T15:11:40", dados_dvr_atualizados_em: "2026-10-07T18:12:00+00:00" },
      agora,
    );
    expect(l).toEqual(["HD: Nenhum HD detectado", "Data e hora: 07/10/2026 15:11:40 (relógio do DVR)", "Consulta do DVR: há 1 min"]);
  });
  it("HD ativo com relógio indisponível", () => {
    const l = linhasTelemetriaDvr({ status_hd: "HD 1: ativo", data_hora_dvr: null, dados_dvr_atualizados_em: "2026-10-07T18:12:30Z" }, agora);
    expect(l[0]).toBe("HD: HD 1: ativo");
    expect(l[1]).toBe("Data e hora: Indisponível");
  });
  it("offline/nulo mostra Indisponível", () => {
    expect(linhasTelemetriaDvr({}, agora)).toEqual(["HD: Indisponível", "Data e hora: Indisponível", "Consulta do DVR: Indisponível"]);
  });
  it("desatualizada após 5 min", () => {
    const l = linhasTelemetriaDvr({ status_hd: "x", dados_dvr_atualizados_em: "2026-10-07T18:00:00Z" }, agora);
    expect(l[2]).toContain("desatualizada");
  });
  it("não aplica fuso", () => {
    expect(formatarHoraDvr("2026-10-07T23:59:59")).toBe("07/10/2026 23:59:59");
  });
});
