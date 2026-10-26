import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Login compatível com o D-Guard (Gear). Aceita username/password ou email/senha.
const schema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/login")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/gear-api.server")).opcoesGear(),
      POST: async ({ request }) => {
        const { jsonGear } = await import("@/lib/gear-api.server");
        let corpo: Record<string, unknown> = {};
        try {
          const tipo = request.headers.get("content-type") ?? "";
          if (tipo.includes("json")) corpo = await request.json();
          else corpo = Object.fromEntries(new URLSearchParams(await request.text()));
        } catch {
          return jsonGear({ error: "Invalid body" }, 400);
        }
        const p = schema.safeParse({
          username: corpo["username"] ?? corpo["email"] ?? corpo["user"],
          password: corpo["password"] ?? corpo["senha"],
        });
        if (!p.success) return jsonGear({ error: "Invalid username or password" }, 400);

        const { createClient } = await import("@supabase/supabase-js");
        const { supabaseUrlServidor, supabasePublishableKeyServidor } = await import(
          "@/integrations/supabase/config.server"
        );
        const key = supabasePublishableKeyServidor();
        if (!key) return jsonGear({ error: "Unavailable" }, 503);
        const client = createClient(supabaseUrlServidor(), key, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        // Gear pode mandar só o usuário (ex.: "admin"): resolve para o e-mail do Sentinela.
        const { usuarioPorLogin } = await import("@/lib/gear-api.server");
        const email = p.data.username.includes("@")
          ? p.data.username
          : ((await usuarioPorLogin(p.data.username))?.email ?? p.data.username);
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password: p.data.password,
        });
        const ua = request.headers.get("user-agent") ?? "";
        const aparelho = /iphone|ipad|android|darwin|cfnetwork|okhttp|dalvik/i.test(ua) ? "CELULAR" : "COMPUTADOR";
        const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        console.info(
          `[gear-login] ${hora} aparelho=${aparelho} usuario=${p.data.username} resultado=${error || !data.session ? "RECUSADO" : "OK"} ua="${ua.slice(0, 160)}"`,
        );
        if (error || !data.session) return jsonGear({ error: "Invalid username or password" }, 401);

        const { emitirTokenDGuard, registrarLoginGear, registrarLoginPorUsuario } = await import("@/lib/gear-api.server");
        registrarLoginGear(request, data.user.id);
        registrarLoginPorUsuario(data.user.id);
        const { guidDeUuid, guidEstavel, dataHoraServidor } = await import("@/lib/dguard.server");
        // userGroupGuid = primeiro cliente vinculado; acesso global = GUID estável.
        const { data: vinc } = await client
          .from("user_clientes")
          .select("cliente_id")
          .eq("user_id", data.user.id);
        const userGroupGuid =
          vinc && vinc.length > 0
            ? guidDeUuid(vinc[0]!.cliente_id)
            : await guidEstavel(`grupo:${data.user.id}`);
        const { serverDate, serverTime } = dataHoraServidor();

        return jsonGear({
          login: {
            username: p.data.username,
            userGuid: guidDeUuid(data.user.id),
            userGroupGuid,
            userToken: await emitirTokenDGuard((data.user.email ?? email).toLowerCase()),
            serverDate,
            serverTime,
          },
        });
      },
    },
  },
});
