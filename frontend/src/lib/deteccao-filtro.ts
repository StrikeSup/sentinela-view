/**
 * Filtro "tipo" da tela Detecção.
 *
 * O filtro lista todos os tipos de src/lib/tipos-deteccao e mostra só as
 * câmeras que estão com aquele tipo ligado. A regra fica separada da tela
 * para poder ser testada sem montar nada.
 */
import { TIPOS_DETECCAO, type TipoDeteccao } from "./tipos-deteccao";

/** Valor do filtro que mostra câmeras de qualquer tipo. */
export const TODOS_OS_TIPOS = "__todos__";

export type LinhaDeteccao = { dvr_id: string; canal: number };

/** Linhas ativas de cada tabela de detecção, por tipo. */
export type DeteccoesPorTipo = Partial<Record<TipoDeteccao, LinhaDeteccao[]>>;

/** Chaves `dvr:canal` de cada tipo. */
export type ChavesPorTipo = Partial<Record<TipoDeteccao, Set<string>>>;

export function chaveCamera(dvrId: string, canal: number): string {
  return `${dvrId}:${canal}`;
}

export function indicesPorTipo(dados: DeteccoesPorTipo | undefined): ChavesPorTipo {
  const saida: ChavesPorTipo = {};
  for (const tipo of TIPOS_DETECCAO) {
    saida[tipo.value] = new Set(
      (dados?.[tipo.value] ?? []).map((l) => chaveCamera(l.dvr_id, l.canal)),
    );
  }
  return saida;
}

/** Câmeras que permanecem visíveis para o tipo escolhido (null = todos os tipos). */
export function camerasDoTipoFiltro<C extends LinhaDeteccao>(
  cameras: C[],
  filtro: TipoDeteccao | null,
  chaves: ChavesPorTipo,
): C[] {
  if (!filtro) return cameras;
  const conjunto = chaves[filtro] ?? new Set<string>();
  return cameras.filter((c) => conjunto.has(chaveCamera(c.dvr_id, c.canal)));
}

/** Opções do filtro, com a quantidade de câmeras ligadas em cada tipo. */
export function opcoesDeTipo(dados: DeteccoesPorTipo | undefined): { value: string; label: string }[] {
  return [
    { value: TODOS_OS_TIPOS, label: "Todos os tipos" },
    ...TIPOS_DETECCAO.map((tipo) => ({
      value: tipo.value as string,
      label: `${tipo.label} (${dados?.[tipo.value]?.length ?? 0})`,
    })),
  ];
}
