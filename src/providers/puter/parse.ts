import type { QuotaEntry } from "../types.js";
import type { PuterQuotaResponse } from "./fetch.js";

export const PUTER_LABEL = "Puter";

export function buildPuterEntries(data: PuterQuotaResponse): QuotaEntry[] {
  const credits = data.credits;
  if (!credits || typeof credits.remaining !== "number" || typeof credits.monthlyAllowance !== "number") return [];
  return [{
    kind: "credits",
    name: PUTER_LABEL,
    group: PUTER_LABEL,
    remaining: credits.remaining,
    allowance: credits.monthlyAllowance,
    resetTimeIso: credits.resetsAt,
  }];
}
