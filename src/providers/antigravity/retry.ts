/**
 * Antigravity: retry policy.
 *
 * The proxy is a local service (127.0.0.1) — requests are cheap and rarely
 * fail. When they bounce (proxy cold start, transient fetch error) we retry a
 * few times with a short backoff so the cold-start race is absorbed without
 * spamming. The last attempt's failure reason is propagated so the caller can
 * render a precise message.
 */

import { fetchProxyStatus, type ProxyStatusResult } from "./fetch.js";
import { resolveProxyPort } from "./fetch.js";

export const ANTIGRAVITY_RETRIES = 3;
export const ANTIGRAVITY_BACKOFF_MS = [150, 400, 1_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchProxyStatusWithRetry(
  timeoutMs: number,
): Promise<ProxyStatusResult> {
  const port = await resolveProxyPort();
  let lastResult: ProxyStatusResult = { status: null, reason: "network" };

  for (let attempt = 0; attempt <= ANTIGRAVITY_RETRIES; attempt += 1) {
    const result = await fetchProxyStatus(port, timeoutMs);
    if (result.status) return result;
    lastResult = result;

    const delay = ANTIGRAVITY_BACKOFF_MS[Math.min(attempt, ANTIGRAVITY_BACKOFF_MS.length - 1)];
    if (delay !== undefined && attempt < ANTIGRAVITY_RETRIES) {
      await sleep(delay);
    }
  }

  return lastResult;
}