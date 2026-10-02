/**
 * Command Code: HTTP fetch of the local proxy /api/quota.
 */

export const COMMANDCODE_DEFAULT_PORT = 7442;
export const COMMANDCODE_STATUS_TIMEOUT_MS = 5_000;

export interface CommandCodeQuotaWindow {
  window: string;
  displayName: string;
  cap: number;
  used: number;
  usedPercent: number;
  remainingPercent: number;
  status: string;
  resetsAtIso?: string | null;
  resetsInSeconds?: number | null;
}

export interface CommandCodeProxyQuotaResponse {
  status: "ok" | "error";
  provider?: string;
  account?: {
    id: string;
    userName: string;
    plan: string;
    planDisplayName: string;
  } | null;
  credits?: {
    currency: string;
    monthlyAllowance: number;
    remaining: number;
    used: number;
    usedPercent: number;
    remainingPercent: number;
  } | null;
  fiveHour?: CommandCodeQuotaWindow | null;
  sevenDay?: CommandCodeQuotaWindow | null;
  timestamp?: string;
}

export type CommandCodeFetchFailureReason =
  | "refused"
  | "timeout"
  | "http"
  | "parse"
  | "network";

export interface CommandCodeQuotaResult {
  quota: CommandCodeProxyQuotaResponse | null;
  reason: CommandCodeFetchFailureReason | null;
}

function failureReason(error: unknown): CommandCodeFetchFailureReason {
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

export async function resolveCommandCodeProxyPort(): Promise<number> {
  const envPort = process.env.COMMANDCODE_PROXY_PORT?.trim();
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return COMMANDCODE_DEFAULT_PORT;
}

export async function fetchCommandCodeProxyQuota(
  port: number,
  timeoutMs: number,
): Promise<CommandCodeQuotaResult> {
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
    const quota = (await response.json()) as CommandCodeProxyQuotaResponse;
    return { quota, reason: null };
  } catch {
    return { quota: null, reason: "parse" };
  }
}
