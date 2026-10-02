/**
 * Command Code proxy provider for OpenCode HUD.
 *
 * Reads live Command Code subscription quota (5h & 7d windows) from commandcode-proxy (GET /api/quota).
 */

import {
  COMMANDCODE_STATUS_TIMEOUT_MS,
  fetchCommandCodeProxyQuota,
  resolveCommandCodeProxyPort,
  type CommandCodeFetchFailureReason,
} from "./fetch.js";
import { COMMANDCODE_LABEL, buildCommandCodeEntries } from "./parse.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function commandCodeError(reason: CommandCodeFetchFailureReason | null): { label: string; message: string } {
  switch (reason) {
    case "refused":
      return { label: COMMANDCODE_LABEL, message: "Proxy not running" };
    case "timeout":
      return { label: COMMANDCODE_LABEL, message: "Proxy timed out" };
    case "http":
      return { label: COMMANDCODE_LABEL, message: "Proxy HTTP error" };
    case "parse":
      return { label: COMMANDCODE_LABEL, message: "Invalid status response" };
    default:
      return { label: COMMANDCODE_LABEL, message: "Unavailable" };
  }
}

export const commandCodeProvider: Provider = {
  id: "commandcode-proxy",

  matchesModel(model): boolean {
    const p = (model.providerID ?? "").trim().toLowerCase();
    const m = (model.modelID ?? "").trim().toLowerCase();
    return (
      p === "commandcode-proxy" ||
      p === "commandcode" ||
      m.startsWith("commandcode-proxy/") ||
      m.startsWith("commandcode-")
    );
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeoutMs = Math.max(1_000, Math.min(ctx.requestTimeoutMs, COMMANDCODE_STATUS_TIMEOUT_MS));
    const port = await resolveCommandCodeProxyPort();
    const result = await fetchCommandCodeProxyQuota(port, timeoutMs);

    if (!result.quota || result.quota.status !== "ok") {
      return {
        attempted: true,
        entries: [],
        errors: [commandCodeError(result.reason)],
      };
    }

    if (!result.quota.account) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: COMMANDCODE_LABEL, message: "No account connected" }],
      };
    }

    return {
      attempted: true,
      entries: buildCommandCodeEntries(result.quota),
      errors: [],
    };
  },
};
