/**
 * Shared types for quota providers.
 *
 * A provider owns everything: how it fetches, how it parses, and how it
 * retries on failure. The refresh layer only calls {@link Provider.load}
 * and renders the resulting entries.
 */

export type QuotaEntry =
  | {
      kind?: "percent";
      /** Display label (already human-friendly), e.g. "Antigravity Gemini". */
      name: string;
      /** Group the entry belongs to (e.g. "Antigravity") for grouping windows. */
      group?: string;
      /** Remaining quota as a percentage (0-100). */
      percentRemaining: number;
      /** Short window label, e.g. "5h", "Weekly", "Claude:". */
      label?: string;
      /** Source-backed ISO reset timestamp. */
      resetTimeIso?: string;
    }
  | {
      kind: "value";
      name: string;
      group?: string;
      value: string;
      resetTimeIso?: string;
    };

export interface QuotaError {
  /** Short label rendered as "label: message". */
  label: string;
  message: string;
}

export interface ProviderResult {
  attempted: boolean;
  entries: QuotaEntry[];
  errors: QuotaError[];
}

export interface ProviderContext {
  /**
   * Duration in ms after which the provider should give up on a request.
   * Each provider is free to cap/normalize its own timeout.
   */
  requestTimeoutMs: number;
}

export interface SessionModelMeta {
  providerID?: string;
  modelID?: string;
}

export interface Provider {
  readonly id: string;
  /**
   * Whether this provider is the quota source for the given active model.
   * The compact line only ever shows the provider(s) matching the current
   * model — not every provider on the machine.
   */
  matchesModel(model: SessionModelMeta): boolean;
  load(ctx: ProviderContext): Promise<ProviderResult>;
}