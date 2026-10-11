/** Fetch the local puter-proxy monthly allowance snapshot. */

export const PUTER_DEFAULT_PORT = 7444;
export const PUTER_STATUS_TIMEOUT_MS = 5_000;

export interface PuterQuotaResponse {
  status: "ok" | "error";
  provider?: string;
  message?: string;
  credits?: {
    unit: string;
    monthlyAllowance: number;
    remaining: number;
    used: number;
    usedPercent: number;
    resetsAt?: string;
  };
}

export type PuterFetchFailureReason = "refused" | "timeout" | "http" | "parse" | "network";

function failureReason(error: unknown): PuterFetchFailureReason {
  const value = error as { code?: string; cause?: { code?: string } } | undefined;
  const code = value?.code ?? value?.cause?.code;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  return "network";
}

export function resolvePuterProxyPort(): number {
  const configured = Number(process.env.PUTER_PROXY_PORT ?? "");
  return Number.isInteger(configured) && configured > 0 && configured < 65536 ? configured : PUTER_DEFAULT_PORT;
}

export async function fetchPuterQuota(port: number, timeoutMs: number): Promise<{ quota: PuterQuotaResponse | null; reason: PuterFetchFailureReason | null }> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/quota`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { quota: null, reason: failureReason(error) };
  }
  if (!response.ok) return { quota: null, reason: "http" };
  try { return { quota: await response.json() as PuterQuotaResponse, reason: null }; }
  catch { return { quota: null, reason: "parse" }; }
}
