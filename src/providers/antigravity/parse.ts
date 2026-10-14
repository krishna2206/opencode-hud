/**
 * Antigravity: parse /api/status into quota entries.
 *
 * Emits separate 5h and weekly Gemini quota windows, health-weighted across
 * accounts. Starter accounts have no 5h summary bucket: use their legacy
 * per-model quota for the 5h entry only. Never synthesize a weekly value from
 * the rolling quota fraction.
 */

import type { QuotaEntry } from "../types.js";
import type { ProxyAccount, ProxyStatus } from "./fetch.js";

export const ANTIGRAVITY_LABEL = "Antigravity";

type Window = "5h" | "weekly";

interface ScoreCandidate {
  health: number;
  fraction: number;
  resetTimeIso?: string;
}

function isFiniteFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

// /api/status reports effectiveHealthScore on the proxy's 0–100 scale.
function healthWeight(account: ProxyAccount): number {
  const score = account.effectiveHealthScore;
  return typeof score === "number" && Number.isFinite(score)
    ? Math.max(0, Math.min(100, score)) / 100
    : 1;
}

/**
 * Earliest reset timestamp strictly after `now` among the given candidates,
 * or undefined when none parse.
 */
function earliestFutureReset(candidates: Array<string | undefined>, now: number): string | undefined {
  let closest: string | undefined;
  let closestMs = Infinity;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = Date.parse(candidate);
    if (Number.isNaN(ms)) continue;
    if (ms >= now && ms < closestMs) {
      closest = candidate;
      closestMs = ms;
    }
  }

  return closest;
}

function geminiSummary(account: ProxyAccount) {
  return (account.quotaSummary ?? []).find((group) => group.displayName.toLowerCase().includes("gemini"));
}

function scoreAccountForWindow(account: ProxyAccount, window: Window): ScoreCandidate | null {
  const summary = geminiSummary(account);
  const bucket = summary?.buckets.find((candidate) => candidate.window === window);

  if (bucket && isFiniteFraction(bucket.remainingFraction)) {
    return {
      health: healthWeight(account),
      fraction: bucket.remainingFraction,
      resetTimeIso: bucket.resetTime,
    };
  }

  // Starter accounts (and old proxy responses before quotaSummary is ready)
  // only have the fetchAvailableModels rolling quota. It corresponds to 5h;
  // it must not be used to fabricate a 7d value.
  if (window === "5h") {
    const legacy = (account.quota ?? []).find((entry) =>
      entry.groupName.toLowerCase().includes("gemini") && isFiniteFraction(entry.remainingFraction),
    );
    if (legacy && isFiniteFraction(legacy.remainingFraction)) {
      return {
        health: healthWeight(account),
        fraction: legacy.remainingFraction,
        resetTimeIso: legacy.resetTime,
      };
    }
  }

  return null;
}

function buildWindowEntry(status: ProxyStatus, window: Window, now: number): QuotaEntry | null {
  const scores = (status.accounts ?? [])
    .map((account) => scoreAccountForWindow(account, window))
    .filter((candidate): candidate is ScoreCandidate => candidate !== null);

  if (scores.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  for (const candidate of scores) {
    weightedSum += candidate.fraction * candidate.health;
    weightSum += candidate.health;
  }

  // If every account has zero health, avoid division by zero and report the
  // unweighted average rather than making a healthy quota appear exhausted.
  const average = weightSum > 0
    ? weightedSum / weightSum
    : scores.reduce((sum, candidate) => sum + candidate.fraction, 0) / scores.length;
  const resetTimeIso = earliestFutureReset(scores.map((candidate) => candidate.resetTimeIso), now);
  const label = window === "weekly" ? "7d" : "5h";

  return {
    kind: "percent",
    name: `${ANTIGRAVITY_LABEL} ${label}`,
    group: ANTIGRAVITY_LABEL,
    label,
    percentRemaining: Math.round(average * 100),
    ...(resetTimeIso ? { resetTimeIso } : {}),
  };
}

export function buildAntigravityEntries(status: ProxyStatus): QuotaEntry[] {
  const now = Date.now();
  return (["5h", "weekly"] as const)
    .map((window) => buildWindowEntry(status, window, now))
    .filter((entry): entry is QuotaEntry => entry !== null);
}
