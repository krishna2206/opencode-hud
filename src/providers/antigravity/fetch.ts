/**
 * Antigravity: HTTP fetch of the local proxy /api/status.
 *
 * The proxy owns OAuth, token refresh and the periodic Google quota scrape;
 * this fetch is a read-only client. The port is resolved from the configured
 * `antigravity-proxy` baseURL, then the ANTIGRAVITY_PROXY_PORT env var, then
 * the default.
 */

export const ANTIGRAVITY_DEFAULT_PORT = 7438;
export const ANTIGRAVITY_STATUS_TIMEOUT_MS = 5_000;

export interface ProxyQuotaBucket {
  bucketId: string;
  displayName: string;
  window: "weekly" | "5h" | string;
  resetTime?: string;
  remainingFraction?: number;
}

export interface ProxyQuotaSummaryGroup {
  displayName: string;
  buckets: ProxyQuotaBucket[];
}

export interface ProxyAccount {
  email: string;
  effectiveHealthScore?: number;
  quotaSummary?: ProxyQuotaSummaryGroup[];
  /** Legacy flat quota fallback (groupName + remainingFraction). */
  quota?: Array<{ groupName: string; remainingFraction?: number; resetTime?: string }>;
}

export interface ProxyStatus {
  accounts: ProxyAccount[];
}

export type ProxyFetchFailureReason =
  | "refused" // nothing listening on the port (proxy not installed/started)
  | "timeout" // request exceeded the timeout
  | "http" // the proxy answered with a non-OK status
  | "parse" // the proxy answered with an unparseable body
  | "network"; // any other transport error

export interface ProxyStatusResult {
  status: ProxyStatus | null;
  reason: ProxyFetchFailureReason | null;
}

function failureReason(error: unknown): ProxyFetchFailureReason {
  const errno = (error as { code?: string; cause?: unknown } | undefined);
  const code = errno?.code ?? (errno?.cause && typeof errno.cause === "object" ? (errno.cause as { code?: string }).code : undefined);

  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  return "network";
}

export async function resolveProxyPort(): Promise<number> {
  const envPort = process.env.ANTIGRAVITY_PROXY_PORT?.trim();
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return ANTIGRAVITY_DEFAULT_PORT;
}

export async function fetchProxyStatus(
  port: number,
  timeoutMs: number,
): Promise<ProxyStatusResult> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { status: null, reason: failureReason(error) };
  }

  if (!response.ok) {
    return { status: null, reason: "http" };
  }

  try {
    const status = (await response.json()) as ProxyStatus;
    return { status, reason: null };
  } catch {
    return { status: null, reason: "parse" };
  }
}