import { describe, expect, it } from "bun:test";
import { codexProvider } from "../src/providers/codex/index.js";
import { buildCodexEntries, CODEX_LABEL } from "../src/providers/codex/parse.js";
import { resolveCodexProxyPort } from "../src/providers/codex/fetch.js";

describe("Codex Provider - Model Matching", () => {
  it("matches codex provider and models", () => {
    expect(codexProvider.matchesModel({ providerID: "codex-proxy" })).toBe(true);
    expect(codexProvider.matchesModel({ providerID: "codex" })).toBe(true);
    expect(codexProvider.matchesModel({ providerID: "CODEX-PROXY" })).toBe(true);
    expect(codexProvider.matchesModel({ modelID: "codex-proxy/codex-gpt-6-astra" })).toBe(true);
    expect(codexProvider.matchesModel({ modelID: "codex-gpt-6-astra" })).toBe(true);
    expect(codexProvider.matchesModel({ modelID: "codex-gpt-5.5" })).toBe(true);
  });

  it("does not match other providers", () => {
    expect(codexProvider.matchesModel({ providerID: "antigravity-proxy" })).toBe(false);
    expect(codexProvider.matchesModel({ providerID: "claude-code-proxy" })).toBe(false);
    expect(codexProvider.matchesModel({ providerID: "opencode-go" })).toBe(false);
    expect(codexProvider.matchesModel({})).toBe(false);
  });
});

describe("Codex Provider - Parse", () => {
  it("builds quota entries for dual window", () => {
    const iso5h = "2026-09-19T22:00:00.000Z";
    const iso7d = "2026-09-26T22:00:00.000Z";

    const entries = buildCodexEntries({
      status: "ok",
      provider: "codex-proxy",
      accountsCount: 2,
      fiveHour: {
        window: "5h",
        displayName: "5-Hour Limit",
        status: "allowed",
        utilization: 0.15,
        utilizationPercent: 15,
        remainingPercent: 85,
        remainingFraction: 0.85,
        resetsAtIso: iso5h,
        resetsInSeconds: 3600,
      },
      sevenDay: {
        window: "7d",
        displayName: "Weekly Limit",
        status: "allowed",
        utilization: 0.2,
        utilizationPercent: 20,
        remainingPercent: 80,
        remainingFraction: 0.8,
        resetsAtIso: iso7d,
        resetsInSeconds: 86400,
      },
    });

    expect(entries.length).toBe(2);

    expect(entries[0]).toEqual({
      kind: "percent",
      name: `${CODEX_LABEL} 5h`,
      group: CODEX_LABEL,
      label: "5h",
      percentRemaining: 85,
      resetTimeIso: iso5h,
    });

    expect(entries[1]).toEqual({
      kind: "percent",
      name: `${CODEX_LABEL} 7d`,
      group: CODEX_LABEL,
      label: "7d",
      percentRemaining: 80,
      resetTimeIso: iso7d,
    });
  });

  it("handles single window or null windows gracefully", () => {
    const entries = buildCodexEntries({
      status: "ok",
      fiveHour: {
        window: "5h",
        displayName: "5-Hour Limit",
        status: "allowed",
        utilization: 0.1,
        utilizationPercent: 10,
        remainingPercent: 90,
        remainingFraction: 0.9,
      },
      sevenDay: null,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].percentRemaining).toBe(90);

    const emptyEntries = buildCodexEntries({
      status: "ok",
      fiveHour: null,
      sevenDay: null,
    });
    expect(emptyEntries.length).toBe(0);
  });
});

describe("Codex Provider - Port Resolution", () => {
  it("resolves default port 7440", async () => {
    delete process.env.CODEX_PROXY_PORT;
    expect(await resolveCodexProxyPort()).toBe(7440);
  });

  it("resolves custom port from environment", async () => {
    process.env.CODEX_PROXY_PORT = "7550";
    expect(await resolveCodexProxyPort()).toBe(7550);
    delete process.env.CODEX_PROXY_PORT;
  });
});
