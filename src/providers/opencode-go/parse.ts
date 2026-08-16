/**
 * OpenCode Go: parse scraped usage into quota entries.
 *
 * Displays the rolling (~5h) and weekly windows as percent-based entries.
 */

import type { QuotaEntry } from "../types.js";
import type { ScrapedUsage } from "./fetch.js";

export const OPENCODE_GO_LABEL = "OpenCode Go";

const OPENCODE_GO_WINDOWS: Array<{ window: "rolling" | "weekly"; name: string; label: string }> = [
  { window: "rolling", name: `${OPENCODE_GO_LABEL} 5h`, label: "5h:" },
  { window: "weekly", name: `${OPENCODE_GO_LABEL} Weekly`, label: "Weekly:" },
];

export function buildOpenCodeGoEntries(usage: ScrapedUsage, now: number): QuotaEntry[] {
  const entries: QuotaEntry[] = [];

  for (const spec of OPENCODE_GO_WINDOWS) {
    const value = usage[spec.window];
    if (!value) continue;

    const usagePercent = Math.max(0, value.usagePercent);
    const resetInSec = Math.max(0, value.resetInSec);

    entries.push({
      kind: "percent",
      name: spec.name,
      group: OPENCODE_GO_LABEL,
      label: spec.label,
      percentRemaining: Math.max(0, 100 - usagePercent),
      resetTimeIso: new Date(now + resetInSec * 1_000).toISOString(),
    });
  }

  return entries;
}