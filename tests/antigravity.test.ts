import { describe, expect, it } from "bun:test";
import type { ProxyStatus } from "../src/providers/antigravity/fetch.js";
import { buildAntigravityEntries } from "../src/providers/antigravity/parse.js";

const future5h = "2099-10-14T10:00:00.000Z";
const future7d = "2099-10-21T10:00:00.000Z";

describe("Antigravity quota parsing", () => {
  it("emits health-weighted 5h and weekly windows with independent resets", () => {
    const status: ProxyStatus = {
      accounts: [
        {
          email: "healthy@example.com",
          effectiveHealthScore: 100,
          quotaSummary: [{
            displayName: "Gemini Models",
            buckets: [
              { bucketId: "gemini-5h", displayName: "Five Hour", window: "5h", remainingFraction: 0.8, resetTime: future5h },
              { bucketId: "gemini-weekly", displayName: "Weekly", window: "weekly", remainingFraction: 0.6, resetTime: future7d },
            ],
          }],
        },
        {
          email: "unhealthy@example.com",
          effectiveHealthScore: 50,
          quotaSummary: [{
            displayName: "Gemini Models",
            buckets: [
              { bucketId: "gemini-5h", displayName: "Five Hour", window: "5h", remainingFraction: 0.2, resetTime: future5h },
              { bucketId: "gemini-weekly", displayName: "Weekly", window: "weekly", remainingFraction: 0.3, resetTime: future7d },
            ],
          }],
        },
      ],
    };

    const entries = buildAntigravityEntries(status);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.label)).toEqual(["5h", "7d"]);
    expect(entries[0]?.percentRemaining).toBe(60); // (80*1 + 20*.5) / 1.5
    expect(entries[0]?.resetTimeIso).toBe(future5h);
    expect(entries[1]?.percentRemaining).toBe(50); // (60*1 + 30*.5) / 1.5
    expect(entries[1]?.resetTimeIso).toBe(future7d);
  });

  it("keeps Starter's legacy rolling quota as 5h only", () => {
    const status: ProxyStatus = {
      accounts: [{
        email: "starter@example.com",
        quota: [{ groupName: "Gemini 3.8 Flash", remainingFraction: 0.4, resetTime: future5h }],
      }],
    };

    const entries = buildAntigravityEntries(status);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("5h");
    expect(entries[0]?.percentRemaining).toBe(40);
    expect(entries[0]?.resetTimeIso).toBe(future5h);
  });

  it("ignores Claude/GPT buckets and doesn't invent missing windows", () => {
    const status: ProxyStatus = {
      accounts: [{
        email: "pro@example.com",
        quotaSummary: [
          {
            displayName: "Gemini Models",
            buckets: [{ bucketId: "gemini-5h", displayName: "Five Hour", window: "5h", remainingFraction: 0.9 }],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              { bucketId: "3p-5h", displayName: "Five Hour", window: "5h", remainingFraction: 0.1 },
              { bucketId: "3p-weekly", displayName: "Weekly", window: "weekly", remainingFraction: 0.1 },
            ],
          },
        ],
      }],
    };

    const entries = buildAntigravityEntries(status);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("5h");
    expect(entries[0]?.percentRemaining).toBe(90);
  });
});
