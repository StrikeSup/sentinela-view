export type PreconexaoDvr = { id: string; canais: number | null; preconectar_ate: string };
export type PreconexaoCamera = { dvr_id: string; canal: number; expira_em: string };
export type PreconexaoPedido = { dvr_id: string; canais: number[]; ate: string };

/** Usa as câmeras dos layouts ativos; a marcação antiga do DVR fica como compatibilidade. */
export function montarPreconexao(
  dvrs: PreconexaoDvr[],
  cameras: PreconexaoCamera[],
  agora = new Date(),
): PreconexaoPedido[] {
  const timestamp = agora.getTime();
  const porDvr = new Map<string, { canais: Set<number>; ate: string }>();
  for (const camera of cameras) {
    if (
      !Number.isInteger(camera.canal) ||
      camera.canal < 1 ||
      camera.canal > 512 ||
      Date.parse(camera.expira_em) <= timestamp
    )
      continue;
    const atual = porDvr.get(camera.dvr_id) ?? { canais: new Set<number>(), ate: camera.expira_em };
    atual.canais.add(camera.canal);
    if (Date.parse(camera.expira_em) > Date.parse(atual.ate)) atual.ate = camera.expira_em;
    porDvr.set(camera.dvr_id, atual);
  }
  for (const dvr of dvrs) {
    if (porDvr.has(dvr.id) || Date.parse(dvr.preconectar_ate) <= timestamp) continue;
    const quantidade = Math.min(16, Math.max(0, Math.trunc(Number(dvr.canais) || 0)));
    if (quantidade > 0)
      porDvr.set(dvr.id, {
        canais: new Set(Array.from({ length: quantidade }, (_, i) => i + 1)),
        ate: dvr.preconectar_ate,
      });
  }
  return [...porDvr].map(([dvr_id, pedido]) => ({
    dvr_id,
    canais: [...pedido.canais].sort((a, b) => a - b).slice(0, 16),
    ate: pedido.ate,
  }));
}
