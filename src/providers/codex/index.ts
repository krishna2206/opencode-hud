/**
 * Codex proxy provider for OpenCode HUD.
 *
 * Reads live Codex subscription quota (5h & 7d windows) from codex-proxy (GET /api/quota).
 */

import {
  CODEX_STATUS_TIMEOUT_MS,
  fetchCodexProxyQuota,
  resolveCodexProxyPort,
  type CodexFetchFailureReason,
} from "./fetch.js";
import { CODEX_LABEL, buildCodexEntries } from "./parse.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function codexError(reason: CodexFetchFailureReason | null): { label: string; message: string } {
  switch (reason) {
    case "refused":
      return { label: CODEX_LABEL, message: "Proxy not running" };
    case "timeout":
      return { label: CODEX_LABEL, message: "Proxy timed out" };
    case "http":
      return { label: CODEX_LABEL, message: "Proxy HTTP error" };
    case "parse":
      return { label: CODEX_LABEL, message: "Invalid status response" };
    default:
      return { label: CODEX_LABEL, message: "Unavailable" };
  }
}

export const codexProvider: Provider = {
  id: "codex-proxy",

  matchesModel(model): boolean {
    const p = (model.providerID ?? "").trim().toLowerCase();
    const m = (model.modelID ?? "").trim().toLowerCase();
    return (
      p === "codex-proxy" ||
      p === "codex" ||
      m.startsWith("codex-proxy/") ||
      m.startsWith("codex-")
    );
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeoutMs = Math.max(1_000, Math.min(ctx.requestTimeoutMs, CODEX_STATUS_TIMEOUT_MS));
    const port = await resolveCodexProxyPort();
    const result = await fetchCodexProxyQuota(port, timeoutMs);

    if (!result.quota || result.quota.status !== "ok") {
      return {
        attempted: true,
        entries: [],
        errors: [codexError(result.reason)],
      };
    }

    if (result.quota.accountsCount === 0) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: CODEX_LABEL, message: "No accounts connected" }],
      };
    }

    return {
      attempted: true,
      entries: buildCodexEntries(result.quota),
      errors: [],
    };
  },
};
