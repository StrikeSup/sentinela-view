import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email().max(255),
  senha: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/public/v1/login")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/api-publica.server")).opcoes(),
      POST: async ({ request }) => {
        const { json } = await import("@/lib/api-publica.server");
        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return json({ erro: "JSON inválido" }, 400);
        }
        const p = schema.safeParse(corpo);
        if (!p.success) return json({ erro: "Informe email e senha." }, 400);

        const { createClient } = await import("@supabase/supabase-js");
        const { supabaseUrlServidor, supabasePublishableKeyServidor } = await import(
          "@/integrations/supabase/config.server"
        );
        const key = supabasePublishableKeyServidor();
        if (!key) return json({ erro: "API indisponível" }, 503);
        const client = createClient(supabaseUrlServidor(), key, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.signInWithPassword({
          email: p.data.email,
          password: p.data.senha,
        });
        if (error || !data.session) return json({ erro: "Email ou senha inválidos." }, 401);
        return json({
          token: data.session.access_token,
          expira_em: data.session.expires_at,
          tipo: "Bearer",
        });
      },
    },
  },
});
