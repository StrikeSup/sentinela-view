import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirCasos } from "./construir";
import { construirCasosVisuais } from "./construir-visual";

const ler = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, n), "utf8"));

describe("casos compartilhados TS × C#", () => {
  it("casos-portao-v2.json é igual à saída atual do TypeScript", () => {
    expect(ler("casos-portao-v2.json")).toEqual(JSON.parse(JSON.stringify(construirCasos())));
  });
  it("casos-visuais-v2.json (sintéticos) é igual à saída atual do TypeScript", () => {
    // Gerado com bun (JavaScriptCore); vitest roda em V8. Math.cos/sin diferem no último bit entre motores
    // (medido: máx. 4,4e-16). Números: tolerância 1e-12; textos, estados e booleanos: idênticos.
    const divergencias: string[] = [];
    const cmp = (a: unknown, b: unknown, p: string): void => {
      if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > 1e-12) divergencias.push(`${p}: ${a} ≠ ${b}`); return; }
      if (typeof a !== "object" || a === null || b === null || typeof b !== "object") { if (a !== b) divergencias.push(`${p}: ${String(a)} ≠ ${String(b)}`); return; }
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) divergencias.push(`${p}: chaves diferentes`);
      for (const k of ka) cmp((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${p}.${k}`);
    };
    cmp(ler("casos-visuais-v2.json"), JSON.parse(JSON.stringify(construirCasosVisuais())), "");
    expect(divergencias).toEqual([]);
  });
  it("casos visuais cobrem fechado, aberto e ambiguidade sem estado divergente", () => {
    const v = construirCasosVisuais();
    const estado = (n: string) => v.casos.find((c) => c.nome === `${n} · equalização, sem máscara`)!.decisoes[1]!.decisao?.estado;
    expect(estado("fechado")).toBe("fechado");
    expect(estado("aberto")).toBe("aberto");

  });
});
