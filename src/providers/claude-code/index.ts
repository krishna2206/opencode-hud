/**
 * Claude Code proxy provider for OpenCode HUD.
 *
 * Reads live Claude Code subscription quota (5h & 7d windows) from claude-code-proxy (GET /api/quota).
 */

import {
  CLAUDE_CODE_STATUS_TIMEOUT_MS,
  fetchClaudeCodeQuota,
  resolveClaudeProxyPort,
  type ClaudeFetchFailureReason,
} from "./fetch.js";
import { CLAUDE_CODE_LABEL, buildClaudeCodeEntries } from "./parse.js";
import type { Provider, ProviderContext, ProviderResult } from "../types.js";

function claudeCodeError(reason: ClaudeFetchFailureReason | null): { label: string; message: string } {
  switch (reason) {
    case "refused":
      return { label: CLAUDE_CODE_LABEL, message: "Proxy not running" };
    case "timeout":
      return { label: CLAUDE_CODE_LABEL, message: "Proxy timed out" };
    case "http":
      return { label: CLAUDE_CODE_LABEL, message: "Proxy HTTP error" };
    case "parse":
      return { label: CLAUDE_CODE_LABEL, message: "Invalid status response" };
    default:
      return { label: CLAUDE_CODE_LABEL, message: "Unavailable" };
  }
}

export const claudeCodeProvider: Provider = {
  id: "claude-code-proxy",

  matchesModel(model): boolean {
    const p = (model.providerID ?? "").trim().toLowerCase();
    const m = (model.modelID ?? "").trim().toLowerCase();
    return p === "claude-code-proxy" || p === "claude-local" || m.startsWith("claude-code-proxy/");
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const timeoutMs = Math.max(1_000, Math.min(ctx.requestTimeoutMs, CLAUDE_CODE_STATUS_TIMEOUT_MS));
    const port = await resolveClaudeProxyPort();
    const result = await fetchClaudeCodeQuota(port, timeoutMs);

    if (!result.quota || result.quota.status !== "ok") {
      return {
        attempted: true,
        entries: [],
        errors: [claudeCodeError(result.reason)],
      };
    }

    return {
      attempted: true,
      entries: buildClaudeCodeEntries(result.quota),
      errors: [],
    };
  },
};
