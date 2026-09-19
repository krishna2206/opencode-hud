/**
 * Codex: HTTP fetch of the local proxy /api/quota.
 */

export const CODEX_DEFAULT_PORT = 7440;
export const CODEX_STATUS_TIMEOUT_MS = 5_000;

export interface CodexQuotaWindow {
  window: string;
  displayName: string;
  status: string;
  utilization: number;
  utilizationPercent: number;
  remainingPercent: number;
  remainingFraction: number;
  resetsAtIso?: string | null;
  resetsInSeconds?: number | null;
  contributingAccounts?: number;
}

export interface CodexProxyQuotaResponse {
  status: "ok" | "unavailable";
  provider?: string;
  accountsCount?: number;
  activeAccountsCount?: number;
  fiveHour?: CodexQuotaWindow | null;
  sevenDay?: CodexQuotaWindow | null;
  timestamp?: string;
}

export type CodexFetchFailureReason =
  | "refused"
  | "timeout"
  | "http"
  | "parse"
  | "network";

export interface CodexQuotaResult {
  quota: CodexProxyQuotaResponse | null;
  reason: CodexFetchFailureReason | null;
}

function failureReason(error: unknown): CodexFetchFailureReason {
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

export async function resolveCodexProxyPort(): Promise<number> {
  const envPort = process.env.CODEX_PROXY_PORT?.trim();
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return CODEX_DEFAULT_PORT;
}

export async function fetchCodexProxyQuota(
  port: number,
  timeoutMs: number,
): Promise<CodexQuotaResult> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/quota`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { quota: null, reason: failureReason(error) };
  }

  if (!response.ok) {
    return { quota: null, reason: "http" };
  }

  try {
    const quota = (await response.json()) as CodexProxyQuotaResponse;
    return { quota, reason: null };
  } catch {
    return { quota: null, reason: "parse" };
  }
}
