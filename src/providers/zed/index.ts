/**
 * Zed proxy provider for OpenCode HUD.
 *
 * Reads the pay-per-token spend (USD, of the connected account) from zed-proxy (GET /api/quota).
 */

import {
  ZED_STATUS_TIMEOUT_MS,
  fetchZedProxyQuota,
  resolveZedProxyPort,
  type ZedFetchFailureReason,
} from "./fetch.js";
import { ZED_LABEL, buildZedEntries } from "./parse.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function zedError(reason: ZedFetchFailureReason | null): { label: string; message: string } {
  switch (reason) {
    case "refused":
      return { label: ZED_LABEL, message: "Proxy not running" };
    case "timeout":
      return { label: ZED_LABEL, message: "Proxy timed out" };
    case "http":
      return { label: ZED_LABEL, message: "Proxy HTTP error" };
    case "parse":
      return { label: ZED_LABEL, message: "Invalid status response" };
    default:
      return { label: ZED_LABEL, message: "Unavailable" };
  }
}

export const zedProvider: Provider = {
  id: "zed-proxy",

  matchesModel(model): boolean {
    const p = (model.providerID ?? "").trim().toLowerCase();
    const m = (model.modelID ?? "").trim().toLowerCase();
    return p === "zed-proxy" || p === "zed" || m.startsWith("zed-proxy/") || m.startsWith("zed/");
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeoutMs = Math.max(1_000, Math.min(ctx.requestTimeoutMs, ZED_STATUS_TIMEOUT_MS));
    const port = await resolveZedProxyPort();
    const result = await fetchZedProxyQuota(port, timeoutMs);

    if (!result.quota) {
      return { attempted: true, entries: [], errors: [zedError(result.reason)] };
    }

    if (result.quota.status !== "ok" || !result.quota.credits) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: ZED_LABEL, message: result.quota.message ?? "No account connected" }],
      };
    }

    // Actionable states win over the spend figure: the account cannot serve requests until reconnected.
    const status = result.quota.state?.status;
    if (status === "login_required" || status === "exhausted") {
      const message = status === "login_required" ? "Login required (/zed-login)" : "Credits exhausted (/zed-login)";
      return { attempted: true, entries: [], errors: [{ label: ZED_LABEL, message }] };
    }

    return { attempted: true, entries: buildZedEntries(result.quota), errors: [] };
  },
};
