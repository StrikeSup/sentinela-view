/**
 * Portão 2.0 — pacote de diagnóstico (Etapa G5). Só leitura: monta um JSON com o quadro que o
 * NAVEGADOR efetivamente processou (192×64 após recorte/redução, antes e depois do realce) e todas as
 * entradas/saídas do cálculo. Não altera a decisão de produção. Sem credenciais, tokens ou URLs.
 */
import { perfilMedio } from "../portao-periodicidade";
import { ancorarValidado, autocorrNoPasso, pitchDominanteV2, type AncoraV2, type SinaisV2 } from "./ritmo";
import type { DecisaoV2, EstadoV2 } from "./fusao";

const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
export const vetorParaLista = (v: Float32Array) => Array.from(v, r3);

export type EntradaDiagnosticoV2 = {
  hora: number;
  larg: number;
  alt: number;
  video: { largura: number; altura: number };
  caixa: readonly [number, number, number, number];
  roi: unknown;
  opcoes: { mascara: boolean; clahe: boolean; avancado: boolean };
  sensibilidade: number;
  /** PNG 192×64 exatamente como o canvas do navegador desenhou (antes do realce). */
  pngReduzido: string | null;
  /** PNG do recorte da ROI na resolução nativa do vídeo (para comparar resoluções fora do navegador). */
  pngNativo: string | null;
  vetor: Float32Array;
  referencias: Float32Array[];
  ancora: AncoraV2 | null;
  sinais: SinaisV2 | null;
  decisao: DecisaoV2;
  anterior: EstadoV2;
  confirmado: EstadoV2;
};

export function montarDiagnosticoV2(e: EntradaDiagnosticoV2) {
  const perfil = perfilMedio(e.vetor, e.larg, e.alt);
  const passoQuadro = pitchDominanteV2(perfil);
  const validacao = ancorarValidado(e.referencias, e.larg, e.alt);
  return {
    tipo: "sentinela-portao-v2-diagnostico",
    versao: 1,
    hora: new Date(e.hora).toISOString(),
    origem: "quadro processado pelo navegador (canvas drawImage)",
    dimensoes: { larg: e.larg, alt: e.alt },
    video: e.video,
    caixa_recorte_px: e.caixa,
    roi: e.roi,
    opcoes: e.opcoes,
    sensibilidade: e.sensibilidade,
    imagens: { reduzido_192x64_png: e.pngReduzido, recorte_nativo_png: e.pngNativo },
    vetor_processado: vetorParaLista(e.vetor),
    perfil_colunas: perfil.map(r3),
    producao: {
      passo_ancorado: e.ancora ? r3(e.ancora.pitch) : null,
      autocorr_quadro_no_passo: e.ancora ? r3(autocorrNoPasso(perfil, e.ancora.pitch)) : null,
      refs_aceitas: e.ancora?.refs.length ?? 0,
      refs_autocorr: e.ancora?.refs.map((r) => r3(r.autocorr)) ?? [],
      sinais: e.sinais,
      decisao: e.decisao,
      anterior_usada: e.anterior,
      confirmado: e.confirmado,
    },
    /** Só comparação (G4, não ligado à produção). */
    validacao_g4: {
      passo_do_quadro: { pitch: r3(passoQuadro.pitch), contraste_autocorr: r3(passoQuadro.autocorr), valido: passoQuadro.valido },
      ancora_pitch: validacao.ancora ? r3(validacao.ancora.pitch) : null,
      referencias: validacao.diagnostico.map((d) => ({ ...d, pitch: r3(d.pitch), autocorr: r3(d.autocorr) })),
    },
    referencias_processadas: e.referencias.map(vetorParaLista),
  };
}
