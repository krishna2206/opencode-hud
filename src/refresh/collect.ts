/**
 * Collect: orchestrates the providers.
 *
 * Runs every provider concurrently and aggregates their results into a single
 * payload for the TUI. The collect knows nothing about how a provider fetches,
 * parses or retries — each provider is a black box returning entries + errors.
 */

import type { Provider, ProviderContext, ProviderResult, QuotaEntry, QuotaError } from "../providers/types.js";

export interface CollectResult {
  attempted: boolean;
  entries: QuotaEntry[];
  errors: QuotaError[];
  providerCount: number;
}

export async function collectQuota(
  providers: readonly Provider[],
  ctx: ProviderContext,
): Promise<CollectResult> {
  const results: ProviderResult[] = await Promise.all(
    providers.map((provider) => provider.load(ctx)),
  );

  const entries: QuotaEntry[] = [];
  const errors: QuotaError[] = [];

  for (const result of results) {
    entries.push(...result.entries);
    errors.push(...result.errors);
  }

  return {
    attempted: results.some((result) => result.attempted),
    entries,
    errors,
    providerCount: providers.length,
  };
}