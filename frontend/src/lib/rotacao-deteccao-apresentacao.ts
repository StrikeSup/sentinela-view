import type { EstadoRotacao } from "./rotacao-deteccao";

export type ApresentacaoRotacaoDeteccao = {
  tipo: "progresso" | "falha";
  titulo: string;
  detalhe: string;
};

type OpcoesApresentacao = {
  nomeLayout: (id: string) => string;
  nomeCamera: (chave: string) => string;
};

export function apresentarRotacaoDeteccao(
  estado: EstadoRotacao | null,
  opcoes: OpcoesApresentacao,
): ApresentacaoRotacaoDeteccao | null {
  if (!estado?.atual || estado.total <= 0) return null;

  const layout = opcoes.nomeLayout(estado.atual);
  if (estado.fase === "aguardando-quadro") {
    const carregadas = Math.max(0, estado.total - estado.faltantes.length);
    return {
      tipo: "progresso",
      titulo: `${layout}: ${carregadas}/${estado.total} câmeras com imagem`,
      detalhe: estado.pendente
        ? `Próximo: ${opcoes.nomeLayout(estado.pendente)}`
        : "Preparando layout",
    };
  }

  if (!estado.falha || estado.faltantes.length === 0) return null;
  const cameras = estado.faltantes.map(opcoes.nomeCamera).join(", ");
  return {
    tipo: "falha",
    titulo: `${layout}: ${estado.faltantes.length}/${estado.total} câmeras sem imagem`,
    detalhe: estado.pendente
      ? `${cameras} — próxima troca: ${opcoes.nomeLayout(estado.pendente)}`
      : `${cameras} — mantendo layout`,
  };
}