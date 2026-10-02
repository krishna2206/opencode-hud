import type { QuotaEntry } from "../types.js";
import type { CommandCodeProxyQuotaResponse } from "./fetch.js";

export const COMMANDCODE_LABEL = "CommandCode";

export function buildCommandCodeEntries(data: CommandCodeProxyQuotaResponse): QuotaEntry[] {
  const entries: QuotaEntry[] = [];

  if (data.fiveHour && typeof data.fiveHour.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${COMMANDCODE_LABEL} 5h`,
      group: COMMANDCODE_LABEL,
      label: "5h",
      percentRemaining: data.fiveHour.remainingPercent,
      resetTimeIso: data.fiveHour.resetsAtIso ?? undefined,
    });
  }

  if (data.sevenDay && typeof data.sevenDay.remainingPercent === "number") {
    entries.push({
      kind: "percent",
      name: `${COMMANDCODE_LABEL} 7d`,
      group: COMMANDCODE_LABEL,
      label: "7d",
      percentRemaining: data.sevenDay.remainingPercent,
      resetTimeIso: data.sevenDay.resetsAtIso ?? undefined,
    });
  }

  return entries;
}
