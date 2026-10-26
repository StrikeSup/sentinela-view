/**
 * Gera casos-portao-v2.json e casos-visuais-v2.json a partir das SAÍDAS REAIS do TypeScript.
 * Rodar: bun src/lib/portao-v2/casos/gerar-casos.ts
 * casos.test.ts confere que os JSON continuam iguais ao TS; os testes C# usam os mesmos arquivos.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { construirCasos } from "./construir";
import { construirCasosVisuais } from "./construir-visual";

for (const [nome, dados] of [["casos-portao-v2.json", construirCasos()], ["casos-visuais-v2.json", construirCasosVisuais()]] as const) {
  const destino = join(import.meta.dirname, nome);
  writeFileSync(destino, JSON.stringify(dados, null, nome === "casos-portao-v2.json" ? 2 : 0) + "\n");
  console.log("gravado", destino);
}
