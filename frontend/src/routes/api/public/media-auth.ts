import { createFileRoute } from "@tanstack/react-router";

// Autenticação HTTP do MediaMTX (authHTTPAddress).
// O MediaMTX envia { user, password, ip, action, path, protocol, id, query }.
type MediaMtxAuth = {
  path?: string;
  action?: string;
  query?: string;
  password?: string;
  user?: string;
  token?: string;
};

function tokenDe(body: MediaMtxAuth): string | null {
  if (body.token) return body.token;
  if (body.password) return body.password;
  if (body.query) {
    const q = new URLSearchParams(body.query.startsWith("?") ? body.query.slice(1) : body.query);
    return q.get("token");
  }
  return null;
}

export const Route = createFileRoute("/api/public/media-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: MediaMtxAuth;
        try {
          body = (await request.json()) as MediaMtxAuth;
        } catch {
          return new Response("JSON inválido", { status: 400 });
        }

        const acao = body.action ?? "";
        // ações administrativas nunca são liberadas por token
        if (acao !== "publish" && acao !== "read") return new Response("Proibido", { status: 403 });

        const { verificarToken } = await import("@/lib/media.server");
        const payload = verificarToken(tokenDe(body));
        if (!payload) return new Response("Não autorizado", { status: 401 });
        if (payload.a !== acao) return new Response("Proibido", { status: 403 });
        if (payload.p !== (body.path ?? "")) return new Response("Proibido", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("video_sessions")
          .select("id, estado, expires_at")
          .eq("id", payload.sid)
          .eq("path", payload.p)
          .maybeSingle();

        if (!data) return new Response("Não autorizado", { status: 401 });
        if (data.estado === "encerrada") return new Response("Proibido", { status: 403 });
        if (new Date(data.expires_at).getTime() + 60_000 < Date.now())
          return new Response("Proibido", { status: 403 });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
