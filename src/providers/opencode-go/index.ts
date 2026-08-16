/**
 * OpenCode Go provider.
 *
 * Scrapes the OpenCode Go workspace dashboard and reports rolling (~5h) and
 * weekly usage as percent-based quota entries. Owns its fetch (external HTML
 * scrape), its parse (SSR + data-slot), and its retry policy (longer backoff
 * for a slower external service).
 */

import type { Provider, ProviderContext, ProviderResult } from "../types.js";
import { resolveCredentials } from "./credentials.js";
import { OPENCODE_GO_SCRAPE_TIMEOUT_MS } from "./fetch.js";
import { OPENCODE_GO_LABEL, buildOpenCodeGoEntries } from "./parse.js";
import { fetchOpenCodeGoWithRetry } from "./retry.js";

export const opencodeGoProvider: Provider = {
  id: "opencode-go",

  matchesModel(model): boolean {
    return (model.providerID ?? "").trim().toLowerCase() === "opencode-go";
  },

  async load(ctx: ProviderContext): Promise<ProviderResult> {
    const resolved = await resolveCredentials();

    if (resolved.state === "missing" || resolved.state === "invalid") {
      return {
        attempted: true,
        entries: [],
        errors: [
          {
            label: OPENCODE_GO_LABEL,
            message: resolved.state === "missing" ? "Not configured (missing credentials)" : resolved.error,
          },
        ],
      };
    }

    if (resolved.state === "incomplete") {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: OPENCODE_GO_LABEL, message: `Missing ${resolved.missing}` }],
      };
    }

    const timeoutMs = Math.max(2_000, Math.min(ctx.requestTimeoutMs, OPENCODE_GO_SCRAPE_TIMEOUT_MS));
    const result = await fetchOpenCodeGoWithRetry({
      workspaceId: resolved.credentials.workspaceId,
      authCookie: resolved.credentials.authCookie,
      timeoutMs,
    });

    if (!result.success) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: OPENCODE_GO_LABEL, message: result.error }],
      };
    }

    const entries = buildOpenCodeGoEntries(result.usage, Date.now());
    if (entries.length === 0) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: OPENCODE_GO_LABEL, message: "No usage windows on the dashboard" }],
      };
    }

    return { attempted: true, entries, errors: [] };
  },
};