/**
 * Casos VISUAIS compartilhados TS × C# do Portão 2.0, gerados executando o TypeScript real
 * (cinzaEqualizado/clahe/mascaraDaArea + ancorar/medir + decidirV2), exatamente o ramo usado
 * por DeteccaoPortaoV2.tsx depois do canvas.
 *
 * TODAS AS IMAGENS SÃO SINTÉTICAS (geradas por código, determinísticas). Não há foto real aqui.
 * Fronteira: RGBA já em 192×64. O redimensionamento do canvas do navegador não entra na paridade.
 */
import { mascaraDaArea, type RoiPortao } from "../../portao-area";
import { ALT_GRADES as ALT, LARG_GRADES as LARG } from "../../portao-grades";
import { cinzaEqualizado } from "../../portao-navegador";
import { cinza, clahe } from "../../portao-processamento";
import { decidirV2, limiaresV2, type EstadoV2 } from "../fusao";
import { ancorar, medir, type SinaisV2 } from "../ritmo";

export const VERSAO_CASOS_VISUAIS = 1;

/** Gerador pseudoaleatório determinístico (LCG) — mesmo resultado em qualquer máquina. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

type Cena = {
  pitch?: number; larguraBarra?: number; fundo?: number; barra?: number; ruido?: number; seed?: number;
  barrasDe?: number; barrasAte?: number; brilho?: number; escala?: number;
  vazio?: [number, number]; poste?: number; carro?: [number, number]; uniforme?: number; gradiente?: number; mistura?: { com: Cena; alfa: number };
};

function cinzaDe(c: Cena): number[] {
  const r = lcg(c.seed ?? 1);
  const out: number[] = [];
  for (let y = 0; y < ALT; y++) for (let x = 0; x < LARG; x++) {
    let v: number;
    if (c.uniforme !== undefined) v = c.uniforme;
    else {
      v = (c.fundo ?? 170) + (c.gradiente ?? 0) * (x / LARG - 0.5) + (r() - 0.5) * 2 * (c.ruido ?? 6);
      const p = c.pitch;
      if (p && x >= (c.barrasDe ?? 0) && x < (c.barrasAte ?? LARG) && x % p < (c.larguraBarra ?? 2) && !(c.vazio && x >= c.vazio[0] && x < c.vazio[1])) v = (c.barra ?? 50) + (r() - 0.5) * 2 * (c.ruido ?? 6);
      if (c.poste !== undefined && x >= c.poste && x < c.poste + 4) v = 35;
      if (c.carro && x >= c.carro[0] && x < c.carro[1] && y > ALT * 0.35) v = 90 + (x % 23 < 2 ? -40 : 0);
    }
    out.push(v);
  }
  const base = c.mistura ? (() => { const o = cinzaDe(c.mistura!.com); return out.map((v, i) => (1 - c.mistura!.alfa) * v + c.mistura!.alfa * o[i]!); })() : out;
  return base.map((v) => Math.max(0, Math.min(255, Math.round(v * (c.escala ?? 1) + (c.brilho ?? 0)))));
}

/** RGB levemente diferente por canal para exercitar os pesos do cinza. */
function rgbaDe(c: Cena): Uint8ClampedArray {
  const g = cinzaDe(c);
  const out = new Uint8ClampedArray(LARG * ALT * 4);
  g.forEach((v, i) => { out[i * 4] = Math.min(255, v + 6); out[i * 4 + 1] = v; out[i * 4 + 2] = Math.max(0, v - 9); out[i * 4 + 3] = 255; });
  return out;
}

const b64 = (rgba: Uint8ClampedArray) => {
  const rgb = new Uint8Array(LARG * ALT * 3);
  for (let i = 0; i < LARG * ALT; i++) { rgb[i * 3] = rgba[i * 4]!; rgb[i * 3 + 1] = rgba[i * 4 + 1]!; rgb[i * 3 + 2] = rgba[i * 4 + 2]!; }
  return Buffer.from(rgb).toString("base64");
};

const FECHADO: Cena = { pitch: 6, seed: 11 };
const ABERTO: Cena = { seed: 21, gradiente: 40 };
const CENAS: Record<string, Cena> = {
  "ref fechado p6 #1": { pitch: 6, seed: 1 },
  "ref fechado p6 #2": { pitch: 6, seed: 2, brilho: 10 },
  "ref fechado p9 destoante": { pitch: 9, seed: 3 },
  "fechado": FECHADO,
  "aberto": ABERTO,
  "aberto + poste e carro ao fundo": { ...ABERTO, poste: 60, carro: [110, 175] },
  "barras só nas extremidades": { pitch: 6, seed: 12, vazio: [24, 168] },
  "meio aberto (barras à esquerda)": { pitch: 6, seed: 13, barrasAte: 96 },
  "fechado mais claro": { ...FECHADO, seed: 14, brilho: 50 },
  "fechado baixo contraste": { pitch: 6, seed: 15, barra: 140, fundo: 170 },
  "fechado escuro (noite sem IR)": { ...FECHADO, seed: 16, escala: 0.08 },
  "imagem inválida (uniforme)": { uniforme: 128 },
  "fechado p5": { pitch: 5, seed: 17 },
  "fechado p8": { pitch: 8, seed: 18, larguraBarra: 3 },
  "fechado p10": { pitch: 10, seed: 19, larguraBarra: 3 },
};
// Portão correndo: barras somem da esquerda para a direita (exercita faixa intermediária e limiares).
for (let k = 0; k <= 10; k++) CENAS[`correndo ${k * 10}% aberto`] = { ...FECHADO, seed: 30 + k, barrasDe: Math.round((k / 10) * LARG) };
// Esmaecimento (neblina/contraluz): mistura com a cena aberta sem retirar as barras.
CENAS["neblina 70%"] = { ...FECHADO, seed: 45, mistura: { com: ABERTO, alfa: 0.7 } };

const POLIGONO: RoiPortao = { x: 0.1, y: 0.2, w: 0.6, h: 0.5, pontos: [{ x: 0.1, y: 0.25 }, { x: 0.7, y: 0.2 }, { x: 0.68, y: 0.7 }, { x: 0.15, y: 0.68 }, { x: 0.12, y: 0.45 }] };
const RETANGULO: RoiPortao = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };

const REFS = ["ref fechado p6 #1", "ref fechado p6 #2", "ref fechado p9 destoante"];
type Teste = { nome: string; refs: string[]; quadro: string };
const TESTES: Teste[] = [
  ...Object.keys(CENAS).filter((n) => !n.startsWith("ref") && !/^fechado p(5|8|10)$/.test(n)).map((q) => ({ nome: q, refs: REFS, quadro: q })),
  { nome: "espaçamento 5 (refs p5)", refs: ["fechado p5"], quadro: "fechado p5" },
  { nome: "espaçamento 8 (refs p8)", refs: ["fechado p8"], quadro: "fechado p8" },
  { nome: "espaçamento 10 (refs p10)", refs: ["fechado p10"], quadro: "fechado p10" },
  { nome: "aberto com refs p10", refs: ["fechado p10"], quadro: "aberto" },
  { nome: "refs sem grades", refs: ["aberto"], quadro: "fechado" },
];
const CONFIGS = [
  { nome: "equalização, sem máscara", clahe: false, roi: null as RoiPortao | null },
  { nome: "CLAHE, sem máscara", clahe: true, roi: null },
  { nome: "equalização, máscara poligonal", clahe: false, roi: POLIGONO },
  { nome: "CLAHE, máscara poligonal", clahe: true, roi: POLIGONO },
  { nome: "equalização, retângulo legado", clahe: false, roi: RETANGULO },
];
const SENS = [0, 50, 100];

const fin = (x: number) => (Number.isFinite(x) ? x : null);
function resumo(v: Float32Array) {
  let soma = 0, quad = 0, nan = 0;
  for (const x of v) if (Number.isFinite(x)) { soma += x; quad += x * x; } else nan++;
  const amostra: (number | null)[] = [];
  for (let i = 0; i < v.length; i += 61) amostra.push(fin(v[i]!));
  return { soma, quad, nan, amostra };
}

export function construirCasosVisuais() {
  const imagens = Object.fromEntries(Object.entries(CENAS).map(([n, c]) => [n, b64(rgbaDe(c))]));
  const rgba = Object.fromEntries(Object.entries(CENAS).map(([n, c]) => [n, rgbaDe(c)]));
  const casos = [];
  for (const cfg of CONFIGS) {
    const mascara = cfg.roi ? mascaraDaArea(cfg.roi, LARG, ALT) : undefined;
    const vet = (n: string) => (cfg.clahe ? clahe(cinza(rgba[n]!), LARG, ALT, mascara) : cinzaEqualizado(rgba[n]!, mascara));
    for (const t of TESTES) {
      const refs = t.refs.map(vet);
      const ancora = ancorar(refs, LARG, ALT);
      const v = vet(t.quadro);
      const sinais: SinaisV2 | null = ancora ? medir(v, ancora, LARG, ALT) : null;
      const decisoes = SENS.map((sens) => {
        const anterior: EstadoV2 = "incerto";
        const d = sinais ? decidirV2(sinais, sens, anterior) : null;
        const { fechar, abrir } = limiaresV2(sens);
        return { sens, anterior, decisao: d, margem: d ? Math.min(Math.abs(d.nota - fechar), Math.abs(d.nota - abrir)) : null };
      });
      casos.push({
        nome: `${t.nome} · ${cfg.nome}`, config: cfg.nome, clahe: cfg.clahe, roi: cfg.roi, refs: t.refs, quadro: t.quadro,
        mascaraValidos: mascara ? mascara.reduce((a, b) => a + b, 0) : LARG * ALT,
        vetor: resumo(v),
        perfilRef0: ancora ? Array.from(ancora.refs[0]!.perfil) : null,
        ancora: ancora ? { pitch: ancora.pitch, refs: ancora.refs.map((r) => ({ energia: r.energia, densidade: r.densidade, contraste: r.contraste, validos: r.validos, autocorr: r.autocorr })) } : null,
        sinais, decisoes,
      });
    }
  }
  // Limiares exatos e vizinhança (±1e-6): estados/faixas não podem divergir.
  const limiares = [];
  for (const sens of SENS) {
    const { fechar, abrir } = limiaresV2(sens);
    for (const alvo of [fechar, abrir]) for (const d of [-1e-6, 0, 1e-6]) {
      const n = alvo + d;
      const sinais: SinaisV2 = { periodicidade: n, densidade: n, ssim: n, pitch: 6, qualidade: 0.9 };
      for (const anterior of ["aberto", "fechado", "incerto"] as EstadoV2[]) limiares.push({ sens, sinais, anterior, esperado: decidirV2(sinais, sens, anterior) });
    }
    for (const q of [0.5 - 1e-6, 0.5, 0.5 + 1e-6]) {
      const sinais: SinaisV2 = { periodicidade: 0.95, densidade: 0.95, ssim: 0.95, pitch: 6, qualidade: q };
      limiares.push({ sens, sinais, anterior: "incerto" as EstadoV2, esperado: decidirV2(sinais, sens, "incerto") });
    }
  }
  return { versao: VERSAO_CASOS_VISUAIS, sintetico: true, larg: LARG, alt: ALT, imagens, casos, limiares };
}
