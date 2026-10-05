import { describe, expect, it } from "bun:test";
import { buildCompactLine, formatUsd } from "../src/hud/compact.js";
import { zedProvider } from "../src/providers/zed/index.js";
import { buildZedEntries } from "../src/providers/zed/parse.js";
import { resolveZedProxyPort } from "../src/providers/zed/fetch.js";

const quota = (used: number, allowance: number) => ({
  status: "ok" as const,
  type: "pay-per-token",
  credits: {
    currency: "USD",
    monthlyAllowance: allowance,
    usedUsd: used,
    remainingUsd: Math.max(0, allowance - used),
    usedPercent: allowance > 0 ? (used / allowance) * 100 : 0,
    remainingPercent: 0,
    renewsAt: "2026-11-04T00:00:00.000Z",
    daysRemaining: 30,
  },
});

describe("Zed provider - model matching", () => {
  it("matches the zed-proxy provider and zed model ids", () => {
    expect(zedProvider.matchesModel({ providerID: "zed-proxy" })).toBe(true);
    expect(zedProvider.matchesModel({ providerID: "ZED" })).toBe(true);
    expect(zedProvider.matchesModel({ modelID: "zed-proxy/claude-sonnet-4-6" })).toBe(true);
  });

  it("does not match other providers", () => {
    expect(zedProvider.matchesModel({ providerID: "commandcode-proxy" })).toBe(false);
    expect(zedProvider.matchesModel({ providerID: "antigravity-proxy" })).toBe(false);
    expect(zedProvider.matchesModel({ modelID: "claude-sonnet-4-6" })).toBe(false);
    expect(zedProvider.matchesModel({})).toBe(false);
  });
});

describe("Zed provider - pay-per-token entry", () => {
  it("builds a single spend entry, with no window percentages", () => {
    expect(buildZedEntries(quota(2.45, 10))).toEqual([
      { kind: "spend", name: "Zed", group: "Zed", usedUsd: 2.45, allowanceUsd: 10, resetTimeIso: "2026-11-04T00:00:00.000Z" },
    ]);
  });

  it("omits the allowance when the plan has none, and yields nothing without credits", () => {
    expect((buildZedEntries(quota(0.5, 0))[0] as any).allowanceUsd).toBeUndefined();
    expect(buildZedEntries({ status: "error" })).toEqual([]);
  });

  it("honours ZED_PROXY_PORT", async () => {
    const previous = process.env.ZED_PROXY_PORT;
    delete process.env.ZED_PROXY_PORT;
    expect(await resolveZedProxyPort()).toBe(7443);
    process.env.ZED_PROXY_PORT = "9000";
    expect(await resolveZedProxyPort()).toBe(9000);
    if (previous === undefined) delete process.env.ZED_PROXY_PORT;
    else process.env.ZED_PROXY_PORT = previous;
  });
});

describe("Zed provider - account state", () => {
  const load = async (body: unknown) => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json(body) });
    const previous = process.env.ZED_PROXY_PORT;
    process.env.ZED_PROXY_PORT = String(server.port);
    try {
      return await zedProvider.load({ requestTimeoutMs: 2000 } as any);
    } finally {
      server.stop(true);
      if (previous === undefined) delete process.env.ZED_PROXY_PORT;
      else process.env.ZED_PROXY_PORT = previous;
    }
  };

  it("shows the spend when the account is fine", async () => {
    const result = await load({ ...quota(2.45, 10), state: { status: "ok" } });
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("asks for a login, or a new account, instead of the spend", async () => {
    const login = await load({ ...quota(2.45, 10), state: { status: "login_required" } });
    expect(login.entries).toEqual([]);
    expect(login.errors[0]!.message).toBe("Login required (/zed-login)");
    const exhausted = await load({ ...quota(10, 10), state: { status: "exhausted" } });
    expect(exhausted.errors[0]!.message).toBe("Credits exhausted (/zed-login)");
  });
});

describe("Zed provider - compact line", () => {
  it("renders 'Zed · $used / $allowance'", () => {
    const line = buildCompactLine({ entries: buildZedEntries(quota(2.45, 10)), errors: [] });
    expect(line.text).toBe("Zed · $2.45 / $10.00");
  });

  it("exposes the used ratio for colouring", () => {
    const spend = (used: number) =>
      buildCompactLine({ entries: buildZedEntries(quota(used, 10)), errors: [] }).parts.find((p) => p.kind === "spend") as
        | { usedRatio: number }
        | undefined;
    expect(spend(2.5)!.usedRatio).toBeCloseTo(0.25);
    expect(spend(9.6)!.usedRatio).toBeCloseTo(0.96);
  });

  it("shows only the spend when there is no allowance", () => {
    expect(buildCompactLine({ entries: buildZedEntries(quota(0.5, 0)), errors: [] }).text).toBe("Zed · $0.50");
  });

  it("sits next to percentage providers without disturbing them", () => {
    const line = buildCompactLine({
      entries: [
        { kind: "percent", name: "OpenCode Go 5h", group: "OpenCode Go", label: "5h", percentRemaining: 71 },
        ...buildZedEntries(quota(2.45, 10)),
      ],
      errors: [],
    });
    expect(line.text).toBe("OpenCode Go · 5h 29% | Zed · $2.45 / $10.00");
  });

  it("formats USD with two decimals and never negative", () => {
    expect(formatUsd(10)).toBe("$10.00");
    expect(formatUsd(-1)).toBe("$0.00");
  });
});
