/**
 * OpenCode Go: HTTP fetch of the workspace dashboard.
 *
 * Scrapes the OpenCode Go workspace page and reads usage data from two
 * possible formats:
 * 1. SolidJS SSR hydration output (`$R[\d+]={...usagePercent...resetInSec...}`)
 * 2. HTML with `data-slot="usage-item"` attributes (newer format)
 *
 * SSR is tried first, then data-slot parsing. Non-OK responses and unparseable
 * pages resolve to a structured failure (never throw).
 */

export const OPENCODE_GO_DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/";
export const OPENCODE_GO_DASHBOARD_URL_SUFFIX = "/go";
export const OPENCODE_GO_SCRAPE_TIMEOUT_MS = 10_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";

const SCRAPED_NUMBER_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;

const RE_ROLLING_PCT_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_ROLLING_RESET_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_WEEKLY_PCT_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_WEEKLY_RESET_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

export interface ScrapedWindowUsage {
  usagePercent: number;
  resetInSec: number;
}

export type ScrapedUsage = Partial<Record<"rolling" | "weekly" | "monthly", ScrapedWindowUsage>>;

export type OpenCodeGoFetchResult =
  | { success: true; usage: ScrapedUsage }
  | { success: false; error: string };

function sanitizeMessage(text: string, maxLength = 120): string {
  const sanitized = text.replaceAll(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, maxLength);
}

function parseWindowUsage(
  html: string,
  rePctFirst: RegExp,
  reResetFirst: RegExp,
): ScrapedWindowUsage | null {
  const pctFirstMatch = rePctFirst.exec(html);
  if (pctFirstMatch) {
    const usagePercent = Number(pctFirstMatch[1]);
    const resetInSec = Number(pctFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  const resetFirstMatch = reResetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return null;
}

/**
 * Parse a human-readable time like "1 hour 56 minutes", "6 days 2 hours".
 * Returns seconds, 0 for "resets now", or null when no duration is present.
 */
function parseHumanReadableTime(timeStr: string): number | null {
  const normalized = timeStr.toLowerCase().trim().replace(/\s+/g, " ");
  if (["reset-now", "reset now", "now", "resets now"].includes(normalized)) {
    return 0;
  }

  let totalSeconds = 0;

  const dayMatch = normalized.match(/(\d+(?:\.\d+)?)\s*days?/);
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*hours?/);
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)\s*minutes?/);
  const secondMatch = normalized.match(/(\d+(?:\.\d+)?)\s*seconds?/);
  const hasDuration = Boolean(dayMatch || hourMatch || minuteMatch || secondMatch);

  if (dayMatch) totalSeconds += Number(dayMatch[1]) * 86400;
  if (hourMatch) totalSeconds += Number(hourMatch[1]) * 3600;
  if (minuteMatch) totalSeconds += Number(minuteMatch[1]) * 60;
  if (secondMatch) totalSeconds += Number(secondMatch[1]);

  return hasDuration ? totalSeconds : null;
}

function parseDataSlotFormat(html: string): ScrapedUsage {
  const result: ScrapedUsage = {};

  const items = html.split(/data-slot="usage-item"/);

  for (let i = 1; i < items.length; i++) {
    const content = items[i]!;

    const labelMatch = content.match(/data-slot="usage-label">([^<]+)</);
    if (!labelMatch) continue;

    const label = labelMatch[1]!.trim().toLowerCase();

    const usageMatch = content.match(/data-slot="usage-value">[^0-9]*(\d+(?:\.\d+)?)/);
    if (!usageMatch) continue;
    const usagePercent = Number(usageMatch[1]);

    const resetMatch = content.match(/data-slot="(reset-time|reset-now)">([\s\S]*?)<\/span>/);
    if (!resetMatch) continue;

    const resetContent = resetMatch[2]!
      .replace(/<!--\$-->/g, "")
      .replace(/<!--\/-->/g, "")
      .replace(/Resets?\s*in\s*/i, "")
      .trim();

    const resetInSec = resetMatch[1] === "reset-now" ? 0 : parseHumanReadableTime(resetContent);

    if (!Number.isFinite(usagePercent) || resetInSec === null || !Number.isFinite(resetInSec)) {
      continue;
    }

    if (label.includes("rolling")) result.rolling = { usagePercent, resetInSec };
    else if (label.includes("weekly")) result.weekly = { usagePercent, resetInSec };
    else if (label.includes("monthly")) result.monthly = { usagePercent, resetInSec };
  }

  return result;
}

function parseUsageFromHtml(html: string): ScrapedUsage {
  let rolling = parseWindowUsage(html, RE_ROLLING_PCT_FIRST, RE_ROLLING_RESET_FIRST);
  let weekly = parseWindowUsage(html, RE_WEEKLY_PCT_FIRST, RE_WEEKLY_RESET_FIRST);

  if (!rolling && !weekly) {
    const dataSlot = parseDataSlotFormat(html);
    rolling = dataSlot.rolling ?? null;
    weekly = dataSlot.weekly ?? null;
  }

  if (!rolling && !weekly) {
    const dataSlotMonthly = parseDataSlotFormat(html);
    const monthly = dataSlotMonthly.monthly ?? null;
    return {
      ...(rolling ? { rolling } : {}),
      ...(weekly ? { weekly } : {}),
      ...(monthly ? { monthly } : {}),
    };
  }

  return {
    ...(rolling ? { rolling } : {}),
    ...(weekly ? { weekly } : {}),
  };
}

async function consumeResponse(response: Response): Promise<OpenCodeGoFetchResult> {
  if (!response.ok) {
    const text = await response.text();
    return {
      success: false,
      error: `OpenCode Go dashboard error ${response.status}: ${sanitizeMessage(text)}`,
    };
  }

  const html = await response.text();
  const usage = parseUsageFromHtml(html);

  if (usage.rolling || usage.weekly || usage.monthly) {
    return { success: true, usage };
  }

  return {
    success: false,
    error: "Could not parse any OpenCode Go dashboard usage windows (rollingUsage, weeklyUsage)",
  };
}

export async function fetchOpenCodeGoDashboard(options: {
  workspaceId: string;
  authCookie: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}): Promise<OpenCodeGoFetchResult> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const url = `${OPENCODE_GO_DASHBOARD_URL_PREFIX}${encodeURIComponent(options.workspaceId)}${OPENCODE_GO_DASHBOARD_URL_SUFFIX}`;

  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        Cookie: `auth=${options.authCookie}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return await consumeResponse(response);
  } catch (error) {
    return {
      success: false,
      error: sanitizeMessage(error instanceof Error ? error.message : String(error)),
    };
  }
}