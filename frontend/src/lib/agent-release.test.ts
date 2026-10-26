import { describe, expect, it } from "vitest";
import { parseAgentRelease } from "./agent-release";

const valid = {
  version: "2026.10.08-abc1234",
  fileName: "Sentinela-Agent-Setup.exe",
  size: 60,
  sha256: "a".repeat(64),
  parts: [
    { path: "releases/2026.10.08-abc1234/part-01", size: 30, sha256: "b".repeat(64) },
    { path: "releases/2026.10.08-abc1234/part-02", size: 30, sha256: "c".repeat(64) },
  ],
};

describe("Agent release manifest", () => {
  it("accepts a complete versioned installer", () => {
    expect(parseAgentRelease(valid)).toEqual(valid);
  });

  it("preserves whether the Windows runtime is included", () => {
    expect(parseAgentRelease({ ...valid, runtimeBundled: true })).toEqual({
      ...valid,
      runtimeBundled: true,
    });
    expect(parseAgentRelease({ ...valid, runtimeBundled: "yes" })).toBeNull();
  });

  it("rejects incomplete parts and unsafe paths", () => {
    expect(parseAgentRelease({ ...valid, size: 61 })).toBeNull();
    expect(
      parseAgentRelease({ ...valid, parts: [{ ...valid.parts[0], path: "../secret" }] }),
    ).toBeNull();
  });

  it("rejects a missing or invalid manifest", () => {
    expect(parseAgentRelease(null)).toBeNull();
    expect(parseAgentRelease({ ...valid, sha256: "invalid" })).toBeNull();
  });
});
