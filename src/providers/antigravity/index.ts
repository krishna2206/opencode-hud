/**
 * Antigravity provider.
 *
 * Reads Google Antigravity quota from the local proxy (GET /api/status) and
 * aggregates it into a health-weighted average per model family. Owns its
 * fetch (local HTTP), its parse (weighted average), and its retry policy
 * (short backoff for proxy cold-start).
 */

import { ANTIGRAVITY_STATUS_TIMEOUT_MS, type ProxyFetchFailureReason } from "./fetch.js";
import { ANTIGRAVITY_LABEL, buildAntigravityEntries } from "./parse.js";
import { fetchProxyStatusWithRetry } from "./retry.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function antigravityError(reason: ProxyFetchFailureReason | null): { label: string; message: string } {
  switch (reason) {
    case "refused":
      return { label: ANTIGRAVITY_LABEL, message: "Proxy not installed or not running" };
    case "timeout":
      return { label: ANTIGRAVITY_LABEL, message: "Proxy timed out" };
    case "http":
      return { label: ANTIGRAVITY_LABEL, message: "Proxy returned an HTTP error" };
    case "parse":
      return { label: ANTIGRAVITY_LABEL, message: "Proxy returned an invalid status" };
    default:
      return { label: ANTIGRAVITY_LABEL, message: "Unavailable" };
  }
}

export const antigravityProvider: Provider = {
  id: "antigravity-proxy",

  matchesModel(model): boolean {
    return (model.providerID ?? "").trim().toLowerCase() === "antigravity-proxy";
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeoutMs = Math.max(1_000, Math.min(ctx.requestTimeoutMs, ANTIGRAVITY_STATUS_TIMEOUT_MS));
    const result = await fetchProxyStatusWithRetry(timeoutMs);

    if (!result.status) {
      return {
        attempted: true,
        entries: [],
        errors: [antigravityError(result.reason)],
      };
    }

    if ((result.status.accounts ?? []).length === 0) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: ANTIGRAVITY_LABEL, message: "No Antigravity accounts connected" }],
      };
    }

    return { attempted: true, entries: buildAntigravityEntries(result.status), errors: [] };
  },
};