import { describe, expect, it } from "bun:test";
import { commandCodeProvider } from "../src/providers/commandcode/index.js";
import { buildCommandCodeEntries, COMMANDCODE_LABEL } from "../src/providers/commandcode/parse.js";
import { resolveCommandCodeProxyPort } from "../src/providers/commandcode/fetch.js";

describe("Command Code Provider - Model Matching", () => {
  it("matches commandcode provider and models", () => {
    expect(commandCodeProvider.matchesModel({ providerID: "commandcode-proxy" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ providerID: "commandcode" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ providerID: "COMMANDCODE-PROXY" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ modelID: "commandcode-proxy/commandcode-deepseek-v4.1-flash" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ modelID: "commandcode-deepseek-v4.1-flash" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ modelID: "commandcode-glm-5.2" })).toBe(true);
    expect(commandCodeProvider.matchesModel({ modelID: "commandcode-space-bunny-alpha" })).toBe(true);
  });

  it("does not match other providers", () => {
    expect(commandCodeProvider.matchesModel({ providerID: "antigravity-proxy" })).toBe(false);
    expect(commandCodeProvider.matchesModel({ providerID: "claude-code-proxy" })).toBe(false);
    expect(commandCodeProvider.matchesModel({ providerID: "codex-proxy" })).toBe(false);
    expect(commandCodeProvider.matchesModel({ providerID: "opencode-go" })).toBe(false);
    expect(commandCodeProvider.matchesModel({})).toBe(false);
  });
});

describe("Command Code Provider - Parse", () => {
  it("builds quota entries for dual window", () => {
    const iso5h = "2026-10-02T21:10:57.270Z";
    const iso7d = "2026-10-09T16:10:57.270Z";

    const entries = buildCommandCodeEntries({
      status: "ok",
      provider: "commandcode-proxy",
      account: {
        id: "46911013-3c7f-4d35-a516-6c1b06292e4b",
        userName: "krishna2206",
        plan: "individual-go-v1",
        planDisplayName: "Go ($1/mo)",
      },
      credits: {
        currency: "USD",
        monthlyAllowance: 10,
        remaining: 9.9649,
        used: 0.0351,
        usedPercent: 0.35,
        remainingPercent: 99.65,
      },
      fiveHour: {
        window: "5h",
        displayName: "5-Hour Cap",
        cap: 3,
        used: 0.0351,
        usedPercent: 1.17,
        remainingPercent: 98.83,
        status: "allowed",
        resetsAtIso: iso5h,
        resetsInSeconds: 12547,
      },
      sevenDay: {
        window: "7d",
        displayName: "Weekly Cap",
        cap: 6,
        used: 0.0351,
        usedPercent: 0.59,
        remainingPercent: 99.41,
        status: "allowed",
        resetsAtIso: iso7d,
        resetsInSeconds: 599347,
      },
    });

    expect(entries.length).toBe(2);

    expect(entries[0]).toEqual({
      kind: "percent",
      name: `${COMMANDCODE_LABEL} 5h`,
      group: COMMANDCODE_LABEL,
      label: "5h",
      percentRemaining: 98.83,
      resetTimeIso: iso5h,
    });

    expect(entries[1]).toEqual({
      kind: "percent",
      name: `${COMMANDCODE_LABEL} 7d`,
      group: COMMANDCODE_LABEL,
      label: "7d",
      percentRemaining: 99.41,
      resetTimeIso: iso7d,
    });
  });

  it("handles single window or null windows gracefully", () => {
    const entries = buildCommandCodeEntries({
      status: "ok",
      fiveHour: {
        window: "5h",
        displayName: "5-Hour Cap",
        cap: 3,
        used: 0.1,
        usedPercent: 3.33,
        remainingPercent: 96.67,
        status: "allowed",
      },
      sevenDay: null,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].percentRemaining).toBe(96.67);

    const emptyEntries = buildCommandCodeEntries({
      status: "ok",
      fiveHour: null,
      sevenDay: null,
    });
    expect(emptyEntries.length).toBe(0);
  });
});

describe("Command Code Provider - Port Resolution", () => {
  it("resolves default port 7442", async () => {
    delete process.env.COMMANDCODE_PROXY_PORT;
    expect(await resolveCommandCodeProxyPort()).toBe(7442);
  });

  it("resolves custom port from environment", async () => {
    process.env.COMMANDCODE_PROXY_PORT = "7552";
    expect(await resolveCommandCodeProxyPort()).toBe(7552);
    delete process.env.COMMANDCODE_PROXY_PORT;
  });
});
