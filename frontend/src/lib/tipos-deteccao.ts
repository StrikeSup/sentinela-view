import { supabase } from "@/integrations/supabase/client";

/**
 * Tipos de detecção que um cliente pode ter.
 * Toda nova função de detecção deve ser adicionada aqui: ela aparece
 * automaticamente na aba "Detecções" do cliente, com liberação e limite de câmeras.
 */
export const TIPOS_DETECCAO = [
  { value: "movimento", label: "Movimento", tabela: "cameras_deteccao" },
  { value: "portao", label: "Portão aberto", tabela: "cameras_portao" },
  { value: "portao_v2", label: "Portão aberto 2.0", tabela: "cameras_portao_v2" },
] as const;

export type TipoDeteccao = (typeof TIPOS_DETECCAO)[number]["value"];

/** Configuração por tipo. `limite` null = sem limite de câmeras. */
export type RegraDeteccao = { liberado: boolean; limite: number | null };
/** null (cliente sem configuração) = todos liberados, sem limite. */
export type DeteccoesCliente = Partial<Record<TipoDeteccao, RegraDeteccao>> | null;

export function regraDe(d: DeteccoesCliente | undefined, tipo: TipoDeteccao): RegraDeteccao {
  if (!d) return { liberado: true, limite: null };
  return d[tipo] ?? { liberado: false, limite: null };
}

/** Lança erro se ativar esta câmera ultrapassar o permitido para o cliente. */
export async function verificarLimiteDeteccao(
  clienteId: string | null | undefined,
  tipo: TipoDeteccao,
  dvrId: string,
  canal: number,
) {
  if (!clienteId) return;
  const { data: cli, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) throw error;
  const regra = regraDe((cli as { deteccoes?: DeteccoesCliente } | null)?.deteccoes, tipo);
  const nome = TIPOS_DETECCAO.find((t) => t.value === tipo)?.label ?? tipo;
  if (!regra.liberado) throw new Error(`Detecção de ${nome} não liberada para este cliente.`);
  if (regra.limite == null) return;
  const configuracaoTipo = TIPOS_DETECCAO.find((t) => t.value === tipo);
  if (!configuracaoTipo) throw new Error(`Tipo de detecção inválido: ${tipo}.`);
  const tabela = configuracaoTipo.tabela;
  const { data: ativas, error: e2 } = await supabase
    .from(tabela as never)
    .select("dvr_id, canal")
    .eq("cliente_id", clienteId)
    .eq("ativo", true);
  if (e2) throw e2;
  const outras = ((ativas ?? []) as { dvr_id: string; canal: number }[]).filter(
    (r) => !(r.dvr_id === dvrId && r.canal === canal),
  ).length;
  if (outras + 1 > regra.limite)
    throw new Error(
      `Limite da licença de detecção de ${nome} excedido. Este cliente pode ativar no máximo ${regra.limite} câmera(s).`,
    );
}

/** Quantidade de câmeras ativas por tipo, por cliente. */
export async function contarDeteccoesAtivas(clienteId: string) {
  const res: Partial<Record<TipoDeteccao, number>> = {};
  for (const t of TIPOS_DETECCAO) {
    const { count } = await supabase
      .from(t.tabela as never)
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("ativo", true);
    res[t.value] = count ?? 0;
  }
  return res;
}
