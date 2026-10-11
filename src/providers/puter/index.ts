/** Puter monthly account credits exposed by puter-proxy. */
import {
  fetchPuterQuota,
  PUTER_STATUS_TIMEOUT_MS,
  resolvePuterProxyPort,
  type PuterFetchFailureReason,
} from "./fetch.js";
import { buildPuterEntries, PUTER_LABEL } from "./parse.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function failure(reason: PuterFetchFailureReason | null) {
  const message = reason === "refused" ? "Proxy not running"
    : reason === "timeout" ? "Proxy timed out"
      : reason === "http" ? "Proxy HTTP error"
        : reason === "parse" ? "Invalid quota response" : "Unavailable";
  return { label: PUTER_LABEL, message };
}

export const puterProvider: Provider = {
  id: "puter",
  matchesModel(model) {
    const provider = (model.providerID ?? "").trim().toLowerCase();
    const modelID = (model.modelID ?? "").trim().toLowerCase();
    return provider === "puter" || provider === "opencode-puter" || modelID.startsWith("puter/") || modelID.startsWith("opencode-puter/");
  },
  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeout = Math.max(1_000, Math.min(ctx.requestTimeoutMs, PUTER_STATUS_TIMEOUT_MS));
    const { quota, reason } = await fetchPuterQuota(resolvePuterProxyPort(), timeout);
    if (!quota) return { attempted: true, entries: [], errors: [failure(reason)] };
    if (quota.status !== "ok") return { attempted: true, entries: [], errors: [{ label: PUTER_LABEL, message: quota.message || "Quota unavailable" }] };
    const entries = buildPuterEntries(quota);
    return { attempted: true, entries, errors: entries.length ? [] : [{ label: PUTER_LABEL, message: "Credit allowance missing" }] };
  },
};
