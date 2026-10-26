// Controle server-only das reproduções por arquivo temporário no Storage.
// Nunca importe este arquivo em código do navegador.
import { randomBytes } from "crypto";

export const BUCKET_GRAVACOES = "recording-playback-temp";

/** Minutos de retenção do arquivo temporário após a última utilização. */
export const RETENCAO_MINUTOS = Number(process.env["RECORDING_TEMP_MINUTES"] ?? 30);
/**
 * Prazo do pedido de exportação. O servidor local converte o trecho para
 * MP4/H.264 antes de enviar, o que leva bem mais tempo que um envio simples.
 */
export const PREPARO_MINUTOS = Number(process.env["RECORDING_EXPORT_MINUTES"] ?? 60);
/** Validade da reserva (lease) de um espectador. */
export const LEASE_MINUTOS = 2;
/** Validade da URL assinada de leitura entregue ao navegador. */
export const DOWNLOAD_SEGUNDOS = 600;

/**
 * Caminho do arquivo temporário. O padrão é MP4: é o formato que o navegador
 * reproduz com segurança. MKV só é usado quando o servidor local informa que
 * a gravação já está nesse formato e não consegue converter.
 */
export function novoObjectPath(serverId: string, recordingId: string, formato?: string | null): string {
  const exportId = randomBytes(16).toString("hex");
  void formato; // navegador: sempre MP4 (H.264/AAC), nunca MKV
  return `${serverId}/${recordingId}/${exportId}.mp4`;
}

export function futuro(minutos: number): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

/** Remove o objeto do bucket e o registro da exportação. */
export async function apagarExport(id: string, objectPath: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    await supabaseAdmin.storage.from(BUCKET_GRAVACOES).remove([objectPath]);
  } catch {
    /* objeto pode já não existir */
  }
  await supabaseAdmin.from("recording_playback_exports").delete().eq("id", id);
}

/**
 * Libera a reserva do usuário. O arquivo NÃO é apagado na hora: ele fica
 * disponível até o fim da janela de retenção, para que reabrir a mesma
 * gravação (ou outro usuário abri-la) não exija um novo envio do servidor
 * local. A limpeza agendada remove o que passou da validade.
 */
export async function liberarLease(exportId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("recording_playback_leases")
    .delete()
    .eq("export_id", exportId)
    .eq("user_id", userId);
}
