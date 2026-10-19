import { describe, expect, it } from "bun:test";
import { claudeCodeProvider } from "../src/providers/claude-code/index.js";
import { buildClaudeCodeEntries, CLAUDE_CODE_LABEL } from "../src/providers/claude-code/parse.js";
import { resolveClaudeProxyPort } from "../src/providers/claude-code/fetch.js";

describe("Claude Code Provider - Model Matching", () => {
  it("matches claude-code-proxy provider and models", () => {
    expect(claudeCodeProvider.matchesModel({ providerID: "claude-code-proxy" })).toBe(true);
    expect(claudeCodeProvider.matchesModel({ providerID: "claude-local" })).toBe(true);
    expect(claudeCodeProvider.matchesModel({ providerID: "CLAUDE-CODE-PROXY" })).toBe(true);
    expect(claudeCodeProvider.matchesModel({ modelID: "claude-code-proxy/claude-sonnet-5-5" })).toBe(true);
  });

  it("does not match other providers", () => {
    expect(claudeCodeProvider.matchesModel({ providerID: "antigravity-proxy" })).toBe(false);
    expect(claudeCodeProvider.matchesModel({ providerID: "codex-proxy" })).toBe(false);
    expect(claudeCodeProvider.matchesModel({ providerID: "opencode-go" })).toBe(false);
    expect(claudeCodeProvider.matchesModel({})).toBe(false);
  });
});

describe("Claude Code Provider - Parse", () => {
  it("builds quota entries for 5h and 7d windows", () => {
    const iso5h = "2026-10-19T09:00:00.000Z";
    const iso7d = "2026-10-24T23:00:00.000Z";

    const entries = buildClaudeCodeEntries({
      status: "ok",
      organizationId: "0e209d19-1366-4464-afaf-9c9f1b66f096",
      workspaceId: "wrkspc_01VeyZCFNBk1d7oT25rzLK2Q",
      fiveHour: {
        status: "allowed",
        utilization: 0.06,
        utilizationPercent: 6,
        remainingPercent: 94,
        resetsAtIso: iso5h,
        resetsInSeconds: 8793,
      },
      sevenDay: {
        status: "allowed",
        utilization: 0.07,
        utilizationPercent: 7,
        remainingPercent: 93,
        resetsAtIso: iso7d,
        resetsInSeconds: 491193,
      },
      lastUpdatedIso: "2026-10-19T06:33:26.872Z",
    });

    expect(entries.length).toBe(2);

    expect(entries[0]).toEqual({
      kind: "percent",
      name: `${CLAUDE_CODE_LABEL} 5h`,
      group: CLAUDE_CODE_LABEL,
      label: "5h",
      percentRemaining: 94,
      resetTimeIso: iso5h,
    });

    expect(entries[1]).toEqual({
      kind: "percent",
      name: `${CLAUDE_CODE_LABEL} 7d`,
      group: CLAUDE_CODE_LABEL,
      label: "7d",
      percentRemaining: 93,
      resetTimeIso: iso7d,
    });
  });

  it("handles missing windows gracefully", () => {
    const entries = buildClaudeCodeEntries({
      status: "ok",
      fiveHour: {
        status: "allowed",
        utilization: 0.06,
        utilizationPercent: 6,
        remainingPercent: 94,
      },
      sevenDay: null,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].percentRemaining).toBe(94);
  });
});

describe("Claude Code Provider - Port Resolution", () => {
  it("resolves default port 7439", async () => {
    delete process.env.CLAUDE_CODE_PROXY_PORT;
    expect(await resolveClaudeProxyPort()).toBe(7439);
  });

  it("resolves custom port from environment", async () => {
    process.env.CLAUDE_CODE_PROXY_PORT = "7449";
    expect(await resolveClaudeProxyPort()).toBe(7449);
    delete process.env.CLAUDE_CODE_PROXY_PORT;
  });
});
