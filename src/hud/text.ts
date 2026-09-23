/** Small display-text helpers shared by TUI formatters. */

/** Strip control characters, collapse whitespace, single line. */
export function sanitizeText(text: string): string {
  const cleaned = text.replaceAll(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned.length === 0 ? "" : cleaned;
}