// Utilitários da API para empresas parceiras. Server-only.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "Server-Timing, Retry-After",
};

export function json(dados: unknown, status = 200) {
  return Response.json(dados, { status, headers: CORS });
}

export function opcoes() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Devolve a mesma resposta com os cabeçalhos CORS da API pública. */
export function comCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** Exige token do login e permissão de visualizar câmeras. */
export async function exigirUsuario(request: Request) {
  const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
  const auth = await usuarioDaRequisicao(request);
  if (!auth) return { erro: json({ erro: "Token inválido ou expirado. Faça login." }, 401) };
  if (!(await podeVisualizar(auth.userId)))
    return { erro: json({ erro: "Usuário sem permissão de visualização." }, 403) };
  return { auth };
}
