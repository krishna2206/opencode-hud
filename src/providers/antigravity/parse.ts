/**
 * Antigravity: parse /api/status into quota entries.
 *
 * Aggregation is a health-weighted average across ALL accounts (not just the
 * best one): for each account the limiting bucket within the family is the
 * minimum of its weekly and 5h remaining fractions (a Starter account exposes
 * only weekly, which is then used directly). Accounts without health data fall
 * back to a simple average. The reported reset is the earliest future reset
 * among the contributing accounts.
 */

import type { QuotaEntry } from "../types.js";
import type { ProxyAccount, ProxyStatus } from "./fetch.js";

export const ANTIGRAVITY_LABEL = "Antigravity";

type Family = "gemini" | "claude";

type FamilyScore = {
  fraction: number;
  resetTimeIso?: string;
};

function classifyFamily(name: string): Family | null {
  const lower = name.toLowerCase();
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("claude") || lower.includes("anthropic") || lower.includes("gpt")) {
    return "claude";
  }
  return null;
}

function isFiniteFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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

interface ScoreCandidate {
  health: number;
  score: FamilyScore;
}

function scoreAccountForFamily(account: ProxyAccount, family: Family, now: number): ScoreCandidate | null {
  const groups = (account.quotaSummary ?? []).filter((group) => classifyFamily(group.displayName) === family);

  let fraction: number | null = null;
  let weekly: number | undefined;
  let fiveHour: number | undefined;
  const resetCandidates: Array<string | undefined> = [];

  for (const group of groups) {
    for (const bucket of group.buckets) {
      resetCandidates.push(bucket.resetTime);
      const value = bucket.remainingFraction;
      if (bucket.window === "weekly") weekly = value;
      else if (bucket.window === "5h") fiveHour = value;
    }
  }

  if (groups.length === 0) {
    // Legacy flat quota fallback: use the most limiting group of the family.
    const legacy = (account.quota ?? []).filter((group) => classifyFamily(group.groupName) === family);
    for (const group of legacy) {
      if (isFiniteFraction(group.remainingFraction)) {
        if (fraction === null || group.remainingFraction < fraction) {
          fraction = group.remainingFraction;
        }
      }
      resetCandidates.push(group.resetTime);
    }
  } else {
    if (weekly !== undefined || fiveHour !== undefined) {
      const candidates = [weekly, fiveHour].filter((value): value is number => isFiniteFraction(value));
      if (candidates.length > 0) {
        fraction = Math.min(...candidates);
      }
    }
  }

  if (fraction === null) return null;

  const resetTimeIso = earliestFutureReset(resetCandidates, now);
  const health = isFiniteFraction(account.effectiveHealthScore) ? (account.effectiveHealthScore as number) : 1;

  return { health, score: { fraction, resetTimeIso } };
}

function buildFamilyEntry(family: Family, status: ProxyStatus, now: number): QuotaEntry | null {
  const scores = (status.accounts ?? [])
    .map((account) => scoreAccountForFamily(account, family, now))
    .filter((candidate): candidate is ScoreCandidate => candidate !== null);

  if (scores.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  for (const candidate of scores) {
    weightedSum += candidate.score.fraction * candidate.health;
    weightSum += candidate.health;
  }

  const average = weightSum > 0 ? weightedSum / weightSum : 0;
  const resetTimeIso = earliestFutureReset(scores.map((candidate) => candidate.score.resetTimeIso), now);

  return {
    kind: "percent",
    name: `${ANTIGRAVITY_LABEL} ${family === "gemini" ? "Gemini" : "Claude"}`,
    group: ANTIGRAVITY_LABEL,
    label: family === "gemini" ? "Gemini:" : "Claude:",
    percentRemaining: Math.round(average * 100),
    ...(resetTimeIso ? { resetTimeIso } : {}),
  };
}

export function buildAntigravityEntries(status: ProxyStatus): QuotaEntry[] {
  const now = Date.now();
  const entries: QuotaEntry[] = [];

  for (const family of ["gemini", "claude"] as const) {
    const entry = buildFamilyEntry(family, status, now);
    if (entry) entries.push(entry);
  }

  return entries;
}