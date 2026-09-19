import type { QuotaEntry } from "../types.js";
import type { CodexProxyQuotaResponse } from "./fetch.js";

export const CODEX_LABEL = "Codex";

export function buildCodexEntries(data: CodexProxyQuotaResponse): QuotaEntry[] {
  const entries: QuotaEntry[] = [];

  if (data.fiveHour && typeof data.fiveHour.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${CODEX_LABEL} 5h`,
      group: CODEX_LABEL,
      label: "5h",
      percentRemaining: data.fiveHour.remainingPercent,
      resetTimeIso: data.fiveHour.resetsAtIso ?? undefined,
    });
  }

  if (data.sevenDay && typeof data.sevenDay.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${CODEX_LABEL} 7d`,
      group: CODEX_LABEL,
      label: "7d",
      percentRemaining: data.sevenDay.remainingPercent,
      resetTimeIso: data.sevenDay.resetsAtIso ?? undefined,
    });
  }

  return entries;
}
