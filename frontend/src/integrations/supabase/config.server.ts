// Configuração server-only do Supabase.
//
// Esta instalação foi migrada definitivamente para o Supabase self-hosted
// (supabase.example.invalid). O ambiente da prévia ainda injeta as variáveis
// SUPABASE_* do projeto antigo em nuvem, o que fazia navegador e API gravarem
// em bancos diferentes (o navegador criava a sessão de vídeo num banco e o
// Agent lia noutro, deixando as câmeras sem imagem).
//
// Por isso a origem é resolvida pelas variáveis SENTINELA_* e só cai nas
// SUPABASE_* como último recurso.

const URL_PADRAO = "https://supabase.example.invalid";

function limpo(valor: string | undefined): string | undefined {
  const v = valor?.trim();
  return v ? v.replace(/\/+$/, "") : undefined;
}

export function supabaseUrlServidor(): string {
  return limpo(process.env["SENTINELA_SUPABASE_URL"]) ?? URL_PADRAO;
}

export function supabasePublishableKeyServidor(): string | undefined {
  return (
    process.env["SENTINELA_SUPABASE_PUBLISHABLE_KEY"]?.trim() ||
    (mesmaOrigem() ? process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim() : undefined) ||
    (mesmaOrigem() ? process.env["SUPABASE_ANON_KEY"]?.trim() : undefined)
  );
}

export function supabaseServiceRoleKeyServidor(): string | undefined {
  return (
    process.env["SENTINELA_SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    (mesmaOrigem() ? process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() : undefined)
  );
}

/** As chaves SUPABASE_* só servem quando apontam para a mesma instância. */
function mesmaOrigem(): boolean {
  const injetada = limpo(process.env["SUPABASE_URL"]);
  return !injetada || injetada === supabaseUrlServidor();
}
