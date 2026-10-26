import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseAgentRelease, type AgentRelease } from "./agent-release";

export const AGENT_RELEASE_BUCKET = "app-agent";

export async function loadAgentRelease(): Promise<AgentRelease | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(AGENT_RELEASE_BUCKET)
    .download("latest.json");
  if (error || !data) return null;
  try {
    return parseAgentRelease(JSON.parse(await data.text()));
  } catch {
    return null;
  }
}
