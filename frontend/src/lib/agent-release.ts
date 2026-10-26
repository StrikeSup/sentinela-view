export type AgentReleasePart = {
  path: string;
  size: number;
  sha256: string;
};

export type AgentRelease = {
  version: string;
  fileName: "Sentinela-Agent-Setup.exe";
  runtimeBundled?: boolean;
  size: number;
  sha256: string;
  parts: AgentReleasePart[];
};

const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,63}$/;

export function parseAgentRelease(value: unknown): AgentRelease | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input["version"] !== "string" || !versionPattern.test(input["version"])) return null;
  if (input["fileName"] !== "Sentinela-Agent-Setup.exe") return null;
  if (input["runtimeBundled"] !== undefined && typeof input["runtimeBundled"] !== "boolean")
    return null;
  if (!Number.isSafeInteger(input["size"]) || (input["size"] as number) < 1) return null;
  if (typeof input["sha256"] !== "string" || !hashPattern.test(input["sha256"])) return null;
  if (!Array.isArray(input["parts"]) || input["parts"].length < 1 || input["parts"].length > 32)
    return null;

  const prefix = `releases/${input["version"]}/part-`;
  const parts: AgentReleasePart[] = [];
  const paths = new Set<string>();
  for (const raw of input["parts"]) {
    if (!raw || typeof raw !== "object") return null;
    const part = raw as Record<string, unknown>;
    if (typeof part["path"] !== "string" || !part["path"].startsWith(prefix)) return null;
    if (!/^releases\/[a-zA-Z0-9.+-]+\/part-[0-9]{2}$/.test(part["path"])) return null;
    if (paths.has(part["path"])) return null;
    if (!Number.isSafeInteger(part["size"]) || (part["size"] as number) < 1) return null;
    if (typeof part["sha256"] !== "string" || !hashPattern.test(part["sha256"])) return null;
    paths.add(part["path"]);
    parts.push({ path: part["path"], size: part["size"] as number, sha256: part["sha256"] });
  }
  if (parts.reduce((sum, part) => sum + part.size, 0) !== input["size"]) return null;
  return {
    version: input["version"],
    fileName: input["fileName"],
    ...(input["runtimeBundled"] !== undefined
      ? { runtimeBundled: input["runtimeBundled"] as boolean }
      : {}),
    size: input["size"] as number,
    sha256: input["sha256"],
    parts,
  };
}
