import type { LeituraNavegador } from "./portao-navegador";
import { estadoPorAbertura, type AberturaGrades, type EstadoTempo } from "./portao-grades";

export type RegistroPortao = {
  id: number;
  hora: number;
  leitura: LeituraNavegador;
  status: EstadoTempo["status"];
  motivo: string;
  confirmacao: string;
  barras: AberturaGrades | null;
  sensibilidade: number;
  tolerancia: number;
  tempo: number;
  alerta: boolean;
  referencias: string;
};

const pc = (x: number) => `${Math.round(x * 100)}%`;

export function motivoPortao(base: LeituraNavegador, barras: AberturaGrades | null): string {
  const r = barras?.ritmo;
  if (r) {
    const faixa = `fechado a partir de ${pc(r.limiarFechar)}, aberto até ${pc(r.limiarAbrir)}`;
    const sinais = `ritmo das grades ${pc(r.periodicidade)}, bordas verticais ${pc(r.densidade)}, semelhança ${pc(r.ssim)}`;
    if (r.estado === "incerto") return `Nota ${pc(r.score)} na faixa de dúvida (${faixa}); decisão pela comparação das fotos (${base.estado}). Sinais: ${sinais}.`;
    return `Nota ${pc(r.score)} igual à foto fechado → ${r.estado} (${faixa}). Sinais: ${sinais}. Passo das barras ≈ ${r.pitch.toFixed(1)} colunas.`;
  }
  if (barras && estadoPorAbertura(barras.abertura) !== "incerto") {
    return `A estimativa pelas barras prevaleceu sobre a comparação inicial (${base.estado}). Abertura ${barras.abertura}%: até 5% indica fechado; a partir de 12% indica aberto.`;
  }
  if (base.distFechado === undefined) return "Ainda não há referências carregadas de ambos os estados.";
  return `${barras ? "Abertura entre 5% e 12%: sem substituição pelas barras. " : "Sem sequência suficiente nas fotos fechadas para estimar abertura. "}${base.gradesPct !== undefined ? "Decisão pela força das grades, com comparação das fotos para desempate." : "Decisão pela diferença para as fotos e margem exigida pela sensibilidade."}`;
}

export function confirmacaoPortao(estado: EstadoTempo): string {
  if (estado.candidato) return `${estado.seguidas}/2 leituras para confirmar ${estado.candidato}; mantém ${estado.status}.`;
  return estado.status === "incerto" ? "Aguardando duas leituras consecutivas iguais." : `Estado confirmado: ${estado.status}.`;
}