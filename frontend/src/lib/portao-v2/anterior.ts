/**
 * Portão 2.0 — leitura anterior usada pela faixa intermediária (histerese visual).
 * Semântica: "anterior" é a ÚLTIMA ESTIMATIVA VISUAL (saída de decidirV2 do quadro anterior),
 * não o estado confirmado. Assim a faixa intermediária só segura uma estimativa que já foi
 * Aberto/Fechado de verdade; Incerto (inclusive por qualidade baixa) não é leitura válida
 * e faz o próximo quadro na faixa continuar Incerto. Sem leitura anterior → Incerto.
 * Limiares não mudam: tudo é decidido por decidirV2.
 */
import { decidirV2, type DecisaoV2, type EstadoV2 } from "./fusao";
import type { SinaisV2 } from "./ritmo";

export function anteriorDaFaixa(ultima: DecisaoV2 | null | undefined): EstadoV2 {
  if (!ultima || ultima.faixa === "qualidade") return "incerto";
  return ultima.estado;
}

/** Cobertura e continuidade abaixo deste valor (estrito) = evidência estrutural de abertura. */
export const EVIDENCIA_ABERTURA_MAX = 0.5;

/**
 * Etapa G6: na faixa intermediária, um Aberto anterior só é mantido se o quadro atual tiver
 * evidência de abertura (cobertura < 50% E continuidade < 50%). Sem ela → Incerto, nunca Fechado.
 * Fechado anterior, sem anterior válido e notas fora da faixa: comportamento inalterado.
 * Sinais ausentes não contam como evidência.
 */
export function decidirComAnterior(s: SinaisV2, sensibilidade: number, ultima: DecisaoV2 | null | undefined): DecisaoV2 {
  const d = decidirV2(s, sensibilidade, anteriorDaFaixa(ultima));
  if (d.faixa !== "intermediaria" || d.estado !== "aberto") return d;
  const cob = s.cobertura ?? 1, cont = s.continuidade ?? 1;
  if (cob < EVIDENCIA_ABERTURA_MAX && cont < EVIDENCIA_ABERTURA_MAX) return d;
  return { ...d, estado: "incerto", motivo: `${d.motivo} — Aberto anterior não mantido: sem evidência estrutural de abertura (cobertura ${Math.round(cob * 100)}%, continuidade ${Math.round(cont * 100)}%; ambas precisam ficar abaixo de 50%)` };
}
