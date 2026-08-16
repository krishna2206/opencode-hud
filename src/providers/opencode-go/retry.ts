/**
 * OpenCode Go: retry policy.
 *
 * External SaaS scrape — slower and more prone to transient failures than the
 * local Antigravity proxy. We retry fewer total times but with a longer,
 * growing backoff. Non-OK and unparseable responses are retried; only after
 * the budget is exhausted do we report the last error.
 */

import {
  fetchOpenCodeGoDashboard,
  type OpenCodeGoFetchResult,
} from "./fetch.js";

export const OPENCODE_GO_RETRIES = 3;
export const OPENCODE_GO_BACKOFF_MS = [3_000, 8_000, 15_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchOpenCodeGoWithRetry(params: {
  workspaceId: string;
  authCookie: string;
  timeoutMs: number;
}): Promise<OpenCodeGoFetchResult> {
  let lastResult: OpenCodeGoFetchResult = { success: false, error: "No attempt made" };

  for (let attempt = 0; attempt <= OPENCODE_GO_RETRIES; attempt += 1) {
    const result = await fetchOpenCodeGoDashboard({
      workspaceId: params.workspaceId,
      authCookie: params.authCookie,
      timeoutMs: params.timeoutMs,
    });

    if (result.success) return result;
    lastResult = result;

    const delay = OPENCODE_GO_BACKOFF_MS[Math.min(attempt, OPENCODE_GO_BACKOFF_MS.length - 1)];
    if (delay !== undefined && attempt < OPENCODE_GO_RETRIES) {
      await sleep(delay);
    }
  }

  return lastResult;
}