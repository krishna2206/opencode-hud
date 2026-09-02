import type { QuotaEntry } from "../types.js";
import type { ClaudeCodeQuotaResponse } from "./fetch.js";

export const CLAUDE_CODE_LABEL = "Claude";

export function buildClaudeCodeEntries(data: ClaudeCodeQuotaResponse): QuotaEntry[] {
  const entries: QuotaEntry[] = [];

  if (data.fiveHour && typeof data.fiveHour.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${CLAUDE_CODE_LABEL} 5h`,
      group: CLAUDE_CODE_LABEL,
      label: "5h",
      percentRemaining: data.fiveHour.remainingPercent,
      resetTimeIso: data.fiveHour.resetsAtIso ?? undefined,
    });
  }

  if (data.sevenDay && typeof data.sevenDay.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${CLAUDE_CODE_LABEL} 7d`,
      group: CLAUDE_CODE_LABEL,
      label: "7d",
      percentRemaining: data.sevenDay.remainingPercent,
      resetTimeIso: data.sevenDay.resetsAtIso ?? undefined,
    });
  }

  return entries;
}
