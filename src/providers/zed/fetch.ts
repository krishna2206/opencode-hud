/**
 * Zed: HTTP fetch of the local zed-proxy /api/quota (pay-per-token, USD).
 */

export const ZED_DEFAULT_PORT = 7443;
export const ZED_STATUS_TIMEOUT_MS = 5_000;

export interface ZedProxyQuotaResponse {
  status: "ok" | "error";
  provider?: string;
  /** "pay-per-token": no 5h/7d windows, only spend in USD. */
  type?: string;
  message?: string;
  /** `login_required` -> reconnect; `exhausted` -> connect another account. */
  state?: { status: "ok" | "login_required" | "exhausted"; message?: string | null } | null;
  credits?: {
    currency: string;
    monthlyAllowance: number;
    usedUsd: number;
    remainingUsd: number;
    usedPercent: number;
    remainingPercent: number;
    renewsAt?: string | null;
    daysRemaining?: number | null;
  } | null;
  timestamp?: string;
}

export type ZedFetchFailureReason = "refused" | "timeout" | "http" | "parse" | "network";

export interface ZedQuotaResult {
  quota: ZedProxyQuotaResponse | null;
  reason: ZedFetchFailureReason | null;
}

function failureReason(error: unknown): ZedFetchFailureReason {
  const errno = error as { code?: string; cause?: unknown } | undefined;
  const code =
    errno?.code ??
    (errno?.cause && typeof errno.cause === "object"
      ? (errno.cause as { code?: string }).code
      : undefined);

  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  return "network";
}

export async function resolveZedProxyPort(): Promise<number> {
  const envPort = process.env.ZED_PROXY_PORT?.trim();
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return ZED_DEFAULT_PORT;
}

export async function fetchZedProxyQuota(port: number, timeoutMs: number): Promise<ZedQuotaResult> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/quota`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { quota: null, reason: failureReason(error) };
  }

  // The proxy answers 404 with a JSON body when no account is connected; keep that readable.
  if (!response.ok && response.status !== 404) {
    return { quota: null, reason: "http" };
  }

  try {
    const quota = (await response.json()) as ZedProxyQuotaResponse;
    return { quota, reason: null };
  } catch {
    return { quota: null, reason: "parse" };
  }
}
