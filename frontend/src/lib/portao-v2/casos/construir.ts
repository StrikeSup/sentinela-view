/** Monta os casos compartilhados TS × C# executando o código TypeScript real. */
import { CONFIRMACAO_INICIAL_V2, CONFIRMACAO_V2, alertaV2, confirmarV2, decidirV2, textoConfirmacaoV2, type ConfirmacaoV2, type EstadoV2 } from "../fusao";
import type { SinaisV2 } from "../ritmo";

export const VERSAO_CASOS = 1;

const SINAIS: { nome: string; sinais: SinaisV2; sens: number; anterior: EstadoV2 }[] = [
  { nome: "fechado claro", sinais: { periodicidade: 0.92, densidade: 0.88, ssim: 0.81, pitch: 6 }, sens: 50, anterior: "incerto" },
  { nome: "aberto claro", sinais: { periodicidade: 0.1, densidade: 0.2, ssim: 0.3, pitch: 6 }, sens: 50, anterior: "incerto" },
  { nome: "faixa intermediária mantém anterior", sinais: { periodicidade: 0.5, densidade: 0.5, ssim: 0.5, pitch: 6 }, sens: 50, anterior: "fechado" },
  { nome: "faixa intermediária sem anterior", sinais: { periodicidade: 0.5, densidade: 0.5, ssim: 0.5, pitch: 6 }, sens: 50, anterior: "incerto" },
  { nome: "qualidade baixa", sinais: { periodicidade: 0.9, densidade: 0.9, ssim: 0.9, pitch: 6, qualidade: 0.3 }, sens: 50, anterior: "aberto" },
  { nome: "detalhes do ritmo", sinais: { periodicidade: 0.71, densidade: 0.64, ssim: 0.58, pitch: 6.4, energia: 0.8, cobertura: 0.75, continuidade: 0.6, espacamento: 0.9, qualidade: 0.95 }, sens: 70, anterior: "incerto" },
  { nome: "sensibilidade 0", sinais: { periodicidade: 0.68, densidade: 0.7, ssim: 0.66, pitch: 6 }, sens: 0, anterior: "aberto" },
  { nome: "sensibilidade 100", sinais: { periodicidade: 0.45, densidade: 0.5, ssim: 0.5, pitch: 6 }, sens: 100, anterior: "fechado" },
  { nome: "limiar exato de fechar", sinais: { periodicidade: 0.65, densidade: 0.65, ssim: 0.65, pitch: 6 }, sens: 50, anterior: "incerto" },
];

const ESTADO: Record<string, EstadoV2> = { A: "aberto", F: "fechado", I: "incerto" };
const SEQUENCIAS: { nome: string; inicial: EstadoV2; desdeMs: number | null; leituras: string; tolerancia: number }[] = [
  { nome: "abre sem Incerto", inicial: "fechado", desdeMs: -60000, leituras: "AA", tolerancia: 20 },
  { nome: "A I A não basta", inicial: "fechado", desdeMs: -60000, leituras: "AIA", tolerancia: 20 },
  { nome: "A I A A confirma", inicial: "fechado", desdeMs: -60000, leituras: "AIAA", tolerancia: 20 },
  { nome: "A IIII A A", inicial: "fechado", desdeMs: -60000, leituras: "AIIIIAA", tolerancia: 20 },
  { nome: "isoladas a cada 8 s", inicial: "fechado", desdeMs: -60000, leituras: "AIIIIIIIAIIIIIIIA", tolerancia: 20 },
  { nome: "isoladas a cada 9 s", inicial: "fechado", desdeMs: -60000, leituras: "AIIIIIIIIAIIIIIIIIA", tolerancia: 20 },
  { nome: "alternância A F", inicial: "fechado", desdeMs: -60000, leituras: "AFAFAFAF", tolerancia: 20 },
  { nome: "cancelamento pelo estado atual", inicial: "fechado", desdeMs: -60000, leituras: "AIAFA", tolerancia: 20 },
  { nome: "fecha com imagem ruim", inicial: "aberto", desdeMs: -60000, leituras: "FIIFF", tolerancia: 20 },
  { nome: "oposta reinicia", inicial: "aberto", desdeMs: -60000, leituras: "AIFF", tolerancia: 20 },
  { nome: "perda de imagem e recuperação", inicial: "aberto", desdeMs: -60000, leituras: "IIIIIIIIIIAA", tolerancia: 20 },
  { nome: "permanência mínima 3 s", inicial: "fechado", desdeMs: -60000, leituras: "AAFFFF", tolerancia: 20 },
  { nome: "início do zero", inicial: "incerto", desdeMs: null, leituras: "FF", tolerancia: 20 },
  { nome: "alerta após tolerância", inicial: "fechado", desdeMs: -60000, leituras: "AA" + "A".repeat(22) + "FF", tolerancia: 20 },
  { nome: "alerta com Incertas no meio", inicial: "fechado", desdeMs: -60000, leituras: "AA" + "IIIII".repeat(2) + "AAAAAAAAAAAA", tolerancia: 15 },
];

export function construirCasos() {
  const decisoes = SINAIS.map((c) => ({ ...c, esperado: decidirV2(c.sinais, c.sens, c.anterior) }));
  const sequencias = SEQUENCIAS.map((c) => {
    let s: ConfirmacaoV2 = { ...CONFIRMACAO_INICIAL_V2, confirmado: c.inicial, desdeMs: c.desdeMs };
    const passos = [...c.leituras].map((ch, i) => {
      const t = i * 1000;
      s = confirmarV2(s, ESTADO[ch]!, t);
      const al = alertaV2(s, t, c.tolerancia);
      return {
        t, leitura: ESTADO[ch]!, confirmado: s.confirmado, candidato: s.candidato, contagem: s.contagem,
        incertosSeguidos: s.incertosSeguidos, desdeMs: s.desdeMs, comIncerto: Boolean(s.comIncerto),
        tempoAbertoSegundos: al.tempoAbertoSegundos, alerta: al.alerta, texto: textoConfirmacaoV2(s),
      };
    });
    return { nome: c.nome, inicial: c.inicial, desdeMs: c.desdeMs, tolerancia: c.tolerancia, passos };
  });
  return { versao: VERSAO_CASOS, config: CONFIRMACAO_V2, decisoes, sequencias };
}
