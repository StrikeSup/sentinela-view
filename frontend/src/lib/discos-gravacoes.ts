export type ConfiguracaoGravacaoDvr = {
  id: string;
  nome: string;
  canais: number;
  canais_gravacao: number[];
  gravar_todos_canais?: boolean | null;
  dias_backup: number;
};

export type TrechoDisco = {
  dvr_id: string | null;
  canal: number | null;
  camera_nome: string | null;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
};

export function canaisConfigurados(dvr: ConfiguracaoGravacaoDvr) {
  if (dvr.gravar_todos_canais) return Array.from({ length: dvr.canais }, (_, i) => i + 1);
  return [...new Set(dvr.canais_gravacao)].filter((n) => Number.isInteger(n) && n > 0 && n <= dvr.canais).sort((a, b) => a - b);
}

/** Sum actual available intervals, merging overlap; gaps never count as recorded time. */
export function diasGravados(trechos: TrechoDisco[]) {
  const intervalos = trechos.flatMap((t) => {
    const inicio = Date.parse(t.inicio);
    const fim = t.fim ? Date.parse(t.fim) : inicio + (t.duracao_segundos ?? 0) * 1000;
    return Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio ? [[inicio, fim]] : [];
  }).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  let total = 0;
  let inicioAtual = 0;
  let fimAtual = 0;
  for (const intervalo of intervalos) {
    const [inicio, fim] = intervalo;
    if (inicio === undefined || fim === undefined) continue;
    if (fimAtual && inicio <= fimAtual) fimAtual = Math.max(fimAtual, fim);
    else {
      total += fimAtual - inicioAtual;
      inicioAtual = inicio;
      fimAtual = fim;
    }
  }
  return (total + fimAtual - inicioAtual) / 86_400_000;
}

export function mediaDias(valores: number[]) {
  return valores.length ? valores.reduce((soma, n) => soma + n, 0) / valores.length : null;
}