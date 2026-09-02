/**
 * Claude Code: HTTP fetch of the local proxy /api/quota.
 */

export const CLAUDE_CODE_DEFAULT_PORT = 7439;
export const CLAUDE_CODE_STATUS_TIMEOUT_MS = 5_000;

export interface ClaudeQuotaWindow {
  status: string;
  utilization: number;
  utilizationPercent: number;
  remainingPercent: number;
  resetsAtIso?: string | null;
  resetsInSeconds?: number | null;
}

export interface ClaudeCodeQuotaResponse {
  status: "ok" | "unavailable";
  organizationId?: string | null;
  workspaceId?: string | null;
  fiveHour?: ClaudeQuotaWindow | null;
  sevenDay?: ClaudeQuotaWindow | null;
  lastUpdatedIso?: string | null;
}

export type ClaudeFetchFailureReason =
  | "refused"
  | "timeout"
  | "http"
  | "parse"
  | "network";

export interface ClaudeQuotaResult {
  quota: ClaudeCodeQuotaResponse | null;
  reason: ClaudeFetchFailureReason | null;
}

function failureReason(error: unknown): ClaudeFetchFailureReason {
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

export async function resolveClaudeProxyPort(): Promise<number> {
  const envPort = process.env.CLAUDE_CODE_PROXY_PORT?.trim();
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return CLAUDE_CODE_DEFAULT_PORT;
}

export async function fetchClaudeCodeQuota(
  port: number,
  timeoutMs: number,
): Promise<ClaudeQuotaResult> {
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
    const quota = (await response.json()) as ClaudeCodeQuotaResponse;
    return { quota, reason: null };
  } catch {
    return { quota: null, reason: "parse" };
  }
}
