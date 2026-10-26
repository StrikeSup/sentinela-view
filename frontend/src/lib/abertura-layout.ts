/** Tempo da seleção do layout ao primeiro quadro na tela; não é latência ponta a ponta. */
export function resumirAberturaLayout(total: number, temposMs: number[]) {
  const tempos = temposMs.filter(Number.isFinite).sort((a, b) => a - b);
  const meio = Math.floor(tempos.length / 2);
  const medianaMs =
    tempos.length === 0
      ? null
      : Math.round(tempos.length % 2 ? tempos[meio]! : (tempos[meio - 1]! + tempos[meio]!) / 2);
  return { prontas: tempos.length, total, medianaMs };
}
