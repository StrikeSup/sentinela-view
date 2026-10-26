import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

// Anexa o token do usuário logado às chamadas de funções de servidor protegidas.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next(
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
  },
);
