import { emTelaExtra, listarMonitores, suportaMonitores } from "@/lib/telas-extras";

/**
 * Permissões que o sistema precisa do navegador para funcionar sozinho:
 * reconhecer os monitores e permitir a abertura das telas extras.
 * A abertura real das telas é feita pelo mesmo clique do usuário.
 */

const CHAVE = "sentinela:permissoes";

export type ResultadoPermissoes = {
  monitores: boolean;
};

const CHAVE_TELAS_RESTAURADAS = "sentinela:telas-restauradas";

/**
 * A marca vale só enquanto a aba estiver viva (sessionStorage) e é apagada
 * no logout — assim cada login novo volta a perguntar, e reiniciar o
 * computador também.
 */
export function telasJaRestauradas(userId: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(CHAVE_TELAS_RESTAURADAS) === userId;
  } catch {
    return false;
  }
}

export function marcarTelasRestauradas(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.sessionStorage.setItem(CHAVE_TELAS_RESTAURADAS, userId);
  } catch {
    /* ignora */
  }
}

/** Chamado ao sair da conta: o próximo login pergunta de novo. */
export function limparTelasRestauradas() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHAVE_TELAS_RESTAURADAS);
  } catch {
    /* ignora */
  }
}

export function permissoesConcedidas() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CHAVE) === "2";
  } catch {
    return true;
  }
}

export function precisaPedirPermissoes() {
  if (typeof window === "undefined") return false;
  if (emTelaExtra()) return false;
  return !permissoesConcedidas();
}

/** Guarda que o usuário já liberou o navegador uma vez. */
export function concluirPermissoes(guardar = true) {
  if (guardar && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CHAVE, "2");
    } catch {
      /* ignora */
    }
  }
}

/** Pede tudo de uma vez — precisa ser chamado dentro de um clique do usuário. */
export async function pedirPermissoes(): Promise<ResultadoPermissoes> {
  const resultado: ResultadoPermissoes = { monitores: !suportaMonitores() };

  // reconhecer os monitores (Window Management)
  if (suportaMonitores()) {
    try {
      const monitores = await listarMonitores();
      resultado.monitores = monitores.length > 0;
    } catch {
      resultado.monitores = false;
    }
  }

  return resultado;
}
