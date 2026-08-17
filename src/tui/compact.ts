/**
 * Compact status line formatter.
 *
 * Renders collected quota entries as one compact, colorizable line:
 *   "Antigravity · Gemini: 71% · Claude: 44%  |  OpenCode Go · 5h 71%"
 *
 * Percentages are shown as "used" (100 - remaining), the current default.
 * Error entries surface only when nothing else is available.
 */

import type { CollectResult } from "../refresh/collect.js";
import { sanitizeText } from "./text.js";

export const COMPACT_PERCENT_DISPLAY_MODE = "used" as const;
export const COMPACT_MAX_WIDTH = 96;
export const COMPACT_UNAVAILABLE_TEXT = "Quota unavailable";
export const COMPACT_LOADING_TEXT = "Quota loading…";

export type CompactPart =
  | { kind: "label"; text: string }
  | { kind: "separator"; text: string }
  | { kind: "percent"; text: string; percentRemaining: number }
  | { kind: "cache"; text: string; hitRatio: number; cachedTokens: number }
  | { kind: "error"; text: string };

const SEPARATOR = " | ";
const WINDOW_SEPARATOR = " · ";

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1_000)}K`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatSessionCachePart(
  inputTokens: number,
  cacheReadTokens: number,
): { text: string; hitRatio: number; cachedTokens: number } | null {
  if (cacheReadTokens <= 0) return null;
  const totalInput = inputTokens + cacheReadTokens;
  const ratio = totalInput > 0 ? Math.round((cacheReadTokens / totalInput) * 100) : 0;
  const formattedCount = formatTokenCount(cacheReadTokens);
  return {
    text: `⚡${ratio}% (${formattedCount})`,
    hitRatio: ratio,
    cachedTokens: cacheReadTokens,
  };
}

function compactText(text: string): string {
  return sanitizeText(text);
}

function percentLabel(percentRemaining: number): string {
  const used = Math.max(0, Math.min(100, 100 - percentRemaining));
  return `${Math.round(used)}%`;
}

function providerName(name: string): string {
  return compactText(name.replace(/^\[([^\]]+)\](.*)$/u, "$1$2"))
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function windowLabel(label: string | undefined): string | null {
  const raw = compactText(label ?? "").replace(/:+$/u, "").trim();
  if (!raw) return null;
  return raw.toLowerCase() === "weekly" ? "7d" : raw;
}

type PercentGroup = {
  provider: string;
  windows: Array<{ label: string | null; text: string; percentRemaining: number }>;
};

function buildPercentGroups(entries: CollectResult["entries"]): { groups: Map<string, PercentGroup>; order: string[] } {
  const groups = new Map<string, PercentGroup>();
  const order: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "value") continue;

    const provider = providerName((entry.group?.trim() && entry.group) || entry.name);
    const key = provider.toLowerCase();
    let group = groups.get(key);

    if (!group) {
      group = { provider, windows: [] };
      groups.set(key, group);
      order.push(key);
    }

    group.windows.push({
      label: windowLabel(entry.label),
      text: percentLabel(entry.percentRemaining),
      percentRemaining: entry.percentRemaining,
    });
  }

  return { groups, order };
}

function formatGroupParts(group: PercentGroup): CompactPart[] {
  if (group.windows.length === 0) return [];

  const parts: CompactPart[] = [
    { kind: "label", text: `${compactText(group.provider)}${WINDOW_SEPARATOR}` },
  ];

  if (group.windows.length === 1) {
    const window = group.windows[0]!;
    if (window.label) parts.push({ kind: "label", text: `${window.label} ` });
    parts.push({ kind: "percent", text: window.text, percentRemaining: window.percentRemaining });
    return parts;
  }

  group.windows.forEach((window, index) => {
    if (index > 0) parts.push({ kind: "separator", text: WINDOW_SEPARATOR });
    if (window.label) parts.push({ kind: "label", text: `${window.label} ` });
    parts.push({ kind: "percent", text: window.text, percentRemaining: window.percentRemaining });
  });

  return parts;
}

function joinParts(parts: CompactPart[]): string {
  return parts.map((part) => part.text).join("");
}

function truncateParts(parts: CompactPart[], maxWidth: number): CompactPart[] {
  if (maxWidth <= 0) return [];

  const truncated: CompactPart[] = [];
  let remaining = maxWidth;
  for (const part of parts) {
    if (part.text.length <= remaining) {
      truncated.push(part);
      remaining -= part.text.length;
      continue;
    }

    if (remaining === 1) {
      truncated.push({ kind: "label", text: "…" });
    } else {
      truncated.push({ ...part, text: `${part.text.slice(0, remaining - 1).trimEnd()}…` });
    }
    break;
  }

  return truncated;
}

export interface CompactLine {
  text: string;
  parts: CompactPart[];
}

export function buildCompactLine(result: CollectResult): CompactLine {
  const { groups, order } = buildPercentGroups(result.entries);

  const groupParts = order
    .map((key) => groups.get(key)!)
    .map(formatGroupParts)
    .filter((parts) => parts.length > 0);

  const segments = groupParts
    .map((parts) => joinParts(parts))
    .filter((text) => text.length > 0);

  const parts: CompactPart[] = [];
  groupParts.forEach((group, index) => {
    if (index > 0) parts.push({ kind: "separator", text: SEPARATOR });
    parts.push(...group);
  });

  if (parts.length === 0 && result.errors.length > 0) {
    const first = result.errors[0]!;
    const message = compactText(`${first.label}: ${first.message}`);
    const errorParts: CompactPart[] = [{ kind: "error", text: message }];
    if (result.errors.length > 1) {
      errorParts.push({ kind: "error", text: ` +${result.errors.length - 1}` });
    }
    parts.push(...truncateParts(errorParts, COMPACT_MAX_WIDTH));
  }

  const truncated = truncateParts(parts, COMPACT_MAX_WIDTH);
  const text = truncated.length > 0 ? joinParts(truncated) : "";

  return text.trim() ? { text, parts: truncated } : { text: "", parts: [] };
}