import type { QuotaEntry } from "../types.js";
import type { ZedProxyQuotaResponse } from "./fetch.js";

export const ZED_LABEL = "Zed";

/**
 * Zed is pay-per-token: one USD spend entry of the connected account, no windows.
 */
export function buildZedEntries(data: ZedProxyQuotaResponse): QuotaEntry[] {
  const credits = data.credits;
  if (!credits || typeof credits.usedUsd !== "number") return [];

  return [
    {
      kind: "spend",
      name: ZED_LABEL,
      group: ZED_LABEL,
      usedUsd: credits.usedUsd,
      allowanceUsd: credits.monthlyAllowance > 0 ? credits.monthlyAllowance : undefined,
      resetTimeIso: credits.renewsAt ?? undefined,
    },
  ];
}
