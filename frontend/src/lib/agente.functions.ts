import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// O status vem da conexão que o próprio servidor mantém com a licença (heartbeat).
// Aqui apenas lemos o último sinal recebido e marcamos offline quando estourou o tempo.
export const verificarServidor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { servidorId: string }) =>
    z.object({ servidorId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: servidor } = await context.supabase
      .from("servidores")
      .select("id, nome, online, ultimo_contato, versao, offline_apos_minutos, config_atualizada_em")
      .eq("id", data.servidorId)
      .maybeSingle();
    if (!servidor) return { ok: false, detalhe: "Servidor não encontrado", versao: null };

    if (!servidor.ultimo_contato)
      return {
        ok: false,
        detalhe: "Nenhum sinal recebido ainda. Configure a licença e a chave no servidor.",
        versao: null,
      };

    const minutos = (Date.now() - new Date(servidor.ultimo_contato).getTime()) / 60000;
    const limite = servidor.offline_apos_minutos || 10;
    const ativo = minutos <= limite;

    if (!ativo && servidor.online) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("servidores").update({ online: false }).eq("id", servidor.id);
    }

    return {
      ok: ativo,
      versao: servidor.versao,
      detalhe: ativo
        ? `Conectado. Último sinal há ${Math.max(0, Math.round(minutos))} min.`
        : `Sem sinal há ${Math.round(minutos)} min (limite de ${limite} min).`,
    };
  });
