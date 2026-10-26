import { createFileRoute } from "@tanstack/react-router";

/**
 * Resolve o endereço HLS público de uma câmera.
 * Usa o endereço informado pelo próprio servidor local no sinal periódico e,
 * quando ausente, o endereço global protegido da infraestrutura.
 */
export const Route = createFileRoute("/api/video/hls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { usuarioDaRequisicao, podeVisualizar } = await import("@/lib/media.server");
        const auth = await usuarioDaRequisicao(request);
        if (!auth) return new Response("Não autorizado", { status: 401 });
        if (!(await podeVisualizar(auth.userId)))
          return new Response("Sem permissão para visualizar câmeras", { status: 403 });

        const url = new URL(request.url);
        const dvrId = url.searchParams.get("dvr_id") ?? "";
        const canal = Number(url.searchParams.get("canal") ?? "0");
        if (!dvrId || !Number.isInteger(canal) || canal < 1)
          return new Response("Dados inválidos", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("cameras")
          .select("path, servidores:servidor_id (midia_hls_base)")
          .eq("dvr_id", dvrId)
          .eq("canal", canal)
          .maybeSingle();

        const path = (data as { path?: string | null } | null)?.path ?? null;
        const doServidor =
          (data as unknown as { servidores: { midia_hls_base: string | null } | null } | null)
            ?.servidores?.midia_hls_base ?? null;
        // Só o endereço realmente anunciado pelo servidor local vale; nunca
        // montamos um HLS a partir de configuração global ou domínio exemplo.
        const base = doServidor?.trim().replace(/\/+$/, "") || null;
        if (!path || !base) return Response.json({ url: null });
        const montada = `${base}/${path}/index.m3u8`;
        try {
          const u = new URL(montada);
          if (u.protocol !== "https:" || /seudominio|example\.com|teste\.flowhelp/.test(u.hostname))
            return Response.json({ url: null });
        } catch {
          return Response.json({ url: null });
        }
        return Response.json({ url: montada });
      },
    },
  },
});
