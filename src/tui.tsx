/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { Provider, SessionModelMeta } from "./providers/types.js";
import { antigravityProvider } from "./providers/antigravity/index.js";
import { opencodeGoProvider } from "./providers/opencode-go/index.js";
import { claudeCodeProvider } from "./providers/claude-code/index.js";
import { codexProvider } from "./providers/codex/index.js";
import { collectQuota, type CollectResult } from "./refresh/collect.js";
import { createRefreshLifecycle } from "./refresh/lifecycle.js";
import { throttleLeading } from "./refresh/throttle.js";
import {
  buildCompactLine,
  COMPACT_LOADING_TEXT,
  COMPACT_UNAVAILABLE_TEXT,
  formatSessionCachePart,
  type CompactLine,
  type CompactPart,
} from "./hud/compact.js";

type Ctx = Plugin.Context;
type Theme = Ctx["theme"];

const id = "opencode-hud";

const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DELAYS_MS = [150, 600] as const;
/**
 * `session.usage.updated` fires after every step of a long agentic run. Quota
 * does not need that granularity, so it is collapsed to one refresh per window;
 * the exact value after a turn comes from `session.idle`.
 */
const STREAMING_REFRESH_THROTTLE_MS = 30_000;
const MOUNT_RECOVERY_DELAYS_MS = [500, 1_500, 4_000] as const;
const REQUEST_TIMEOUT_MS = 5_000;

const COMPACT_PERCENT_WARNING_THRESHOLD = 50;
const COMPACT_PERCENT_ERROR_THRESHOLD = 20;

const PROVIDERS: readonly Provider[] = [
  antigravityProvider,
  opencodeGoProvider,
  claudeCodeProvider,
  codexProvider,
];

type CompactState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; line: CompactLine };

function buildCompactState(result: CollectResult, previous: CompactState): CompactState {
  if (result.entries.length > 0) {
    const line = buildCompactLine(result);
    return line.text ? { status: "ready", line } : { status: "unavailable" };
  }

  // The active provider(s) returned nothing usable: if we already had a value,
  // keep it (no flicker between a value and an error message on a transient
  // failure). Otherwise surface the provider's custom error, if any.
  if (previous.status === "ready") return previous;

  const line = buildCompactLine(result);
  if (line.text) return { status: "ready", line };
  return result.errors.length > 0 ? { status: "unavailable" } : { status: "loading" };
}

function extractSessionModelMeta(input: unknown): SessionModelMeta {
  if (!input || typeof input !== "object") return {};
  const item = input as { model?: { providerID?: string; id?: string } };
  const providerID = item.model?.providerID;
  const modelID = item.model?.id;
  return providerID || modelID ? { providerID, modelID } : {};
}

/**
 * Resolve the model in use for a session: the session record first, then the
 * last assistant message. The data layer may not have synced a session the
 * host has not rendered yet, so a miss triggers one sync before giving up.
 */
async function getSessionModelMeta(ctx: Ctx, sessionID: string): Promise<SessionModelMeta> {
  const fromData = (): SessionModelMeta => {
    const meta = extractSessionModelMeta(ctx.data.session.get(sessionID));
    if (meta.providerID || meta.modelID) return meta;
    const messages = ctx.data.session.message.list(sessionID);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.type === "assistant") {
        const fromMessage = extractSessionModelMeta(message);
        if (fromMessage.providerID || fromMessage.modelID) return fromMessage;
      }
    }
    return {};
  };

  const first = fromData();
  if (first.providerID || first.modelID) return first;
  await ctx.data.session.sync(sessionID).catch(() => {});
  return fromData();
}

function activeProviders(activeIds: string[]): Provider[] {
  return PROVIDERS.filter((provider) => activeIds.includes(provider.id));
}

interface QuotaState {
  state: () => CompactState;
  resolveSession: (sessionID: string | undefined) => Promise<void>;
  dispose: () => void;
}

function createQuotaState(ctx: Ctx): QuotaState {
  const [state, setState] = createSignal<CompactState>({ status: "disabled" });
  const [activeIds, setActiveIds] = createSignal<string[]>([]);
  let previous: CompactState = { status: "disabled" };
  let appliedIds = new Set<string>();
  let resolveVersion = 0;
  let resolvedFor: string | undefined;

  const lifecycle = createRefreshLifecycle({
    load: async () => {
      const providers = activeProviders(activeIds());
      const result = await collectQuota(providers, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
      return { providers, result };
    },
    apply: (payload) => {
      const ids = new Set(payload.providers.map((provider) => provider.id));
      const sameSet =
        appliedIds.size === ids.size && [...appliedIds].every((id) => ids.has(id));

      if (!sameSet) {
        appliedIds = ids;
        previous = { status: "disabled" };
      }

      if (payload.providers.length === 0) {
        previous = { status: "disabled" };
        setState({ status: "disabled" });
        return;
      }

      const next = buildCompactState(payload.result, previous);
      previous = next;
      setState(next);
    },
    intervalMs: REFRESH_INTERVAL_MS,
    eventRefreshDelaysMs: EVENT_REFRESH_DELAYS_MS,
    recoveryDelaysMs: MOUNT_RECOVERY_DELAYS_MS,
    subscribe: (scheduleRefresh) => [
      // A turn finished: this is the moment quota actually changed.
      ctx.data.on("session.idle", () => scheduleRefresh()),
      ctx.data.on("session.revert.committed", () => scheduleRefresh()),
      // Long agentic runs only go idle at the very end; usage updates arrive
      // per step, throttled so a run costs one refresh per window.
      ctx.data.on(
        "session.usage.updated",
        throttleLeading(() => scheduleRefresh(), STREAMING_REFRESH_THROTTLE_MS),
      ),
      // A model switch can change which quota applies. The event carries the
      // new model, which the session record may not reflect yet; other
      // sessions' switches are ignored.
      ctx.data.on("session.model.selected", (event) => {
        if (event.data.sessionID !== currentSession) return;
        resolvedFor = undefined;
        void resolve(currentSession, extractSessionModelMeta(event.data));
      }),
    ],
  });

  let currentSession: string | undefined;
  const resolve = async (sessionID: string | undefined, known?: SessionModelMeta) => {
    currentSession = sessionID;
    if (sessionID === resolvedFor) return;
    resolvedFor = sessionID;
    const version = ++resolveVersion;
    if (!sessionID) {
      setActiveIds([]);
      lifecycle.reload();
      return;
    }

    const meta = known ?? (await getSessionModelMeta(ctx, sessionID));
    if (version !== resolveVersion) return;

    const ids = PROVIDERS.filter((provider) => provider.matchesModel(meta)).map(
      (provider) => provider.id,
    );
    setActiveIds(ids);
    lifecycle.reload();
  };

  return {
    state,
    resolveSession: resolve,
    dispose: lifecycle.dispose,
  };
}

/**
 * Prompt-cache stats from the most recent assistant step of the session.
 * Uses the last assistant message's token usage (per-step) rather than the
 * session cumulative counters, so a cache regression is visible immediately.
 * Returns null when no assistant message has usable token data yet.
 */
function lastStepCachePart(ctx: Ctx, sessionID: string): {
  text: string;
  hitRatio: number;
  cachedTokens: number;
} | null {
  const messages = ctx.data.session.message.list(sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    const input = message.tokens?.input ?? 0;
    const cacheRead = message.tokens?.cache?.read ?? 0;
    if (input <= 0 && cacheRead <= 0) continue;
    return formatSessionCachePart(input, cacheRead);
  }
  return null;
}

function feedback(theme: Theme, kind: "success" | "warning" | "error"): RGBA {
  return theme.text.feedback[kind].base;
}

function compactPartColor(part: CompactPart, theme: Theme): RGBA | undefined {
  if (part.kind === "error") return feedback(theme, "error");

  if (part.kind === "percent") {
    const remaining = part.percentRemaining;
    if (Number.isFinite(remaining)) {
      if (remaining >= COMPACT_PERCENT_WARNING_THRESHOLD) return feedback(theme, "success");
      if (remaining >= COMPACT_PERCENT_ERROR_THRESHOLD) return feedback(theme, "warning");
      return feedback(theme, "error");
    }
  }

  if (part.kind === "cache") {
    if (part.hitRatio >= 50) return feedback(theme, "success");
    if (part.hitRatio > 0) return feedback(theme, "warning");
    return theme.text.muted;
  }

  return theme.text.muted;
}

/** The live prompt-cache part for a session, whatever the quota provider knows. */
function sessionCachePart(ctx: Ctx, sessionID: string | undefined): CompactPart | undefined {
  if (!sessionID) return undefined;
  try {
    const cachePart = lastStepCachePart(ctx, sessionID);
    if (!cachePart) return undefined;
    return {
      kind: "cache",
      text: cachePart.text,
      hitRatio: cachePart.hitRatio,
      cachedTokens: cachePart.cachedTokens,
    };
  } catch {
    return undefined;
  }
}

function CompactStatusLine(props: { ctx: Ctx; state: () => CompactState; sessionID?: string }) {
  const cache = createMemo(() => sessionCachePart(props.ctx, props.sessionID));

  // Quota parts when the provider has them, then the live prompt-cache stats of
  // the last assistant step. The cache part stands on its own: models with no
  // quota provider still show it.
  const parts = createMemo((): CompactPart[] => {
    const state = props.state();
    const quotaParts = state.status === "ready" ? [...state.line.parts] : [];
    const cachePart = cache();
    if (!cachePart) return quotaParts;
    if (quotaParts.length === 0) return [cachePart];
    return [...quotaParts, { kind: "separator", text: " · " }, cachePart];
  });

  const mutedText = () => {
    const state = props.state();
    if (state.status === "loading") return COMPACT_LOADING_TEXT;
    if (state.status === "unavailable") return COMPACT_UNAVAILABLE_TEXT;
    return "";
  };

  return (
    <Show when={parts().length > 0 || mutedText()}>
      <box flexDirection="row">
        {parts().length > 0 ? (
          parts().map((part) => (
            <text fg={compactPartColor(part, props.ctx.theme)} wrapMode="none">
              {part.text}
            </text>
          ))
        ) : (
          <text fg={props.ctx.theme.text.muted} wrapMode="none">
            {mutedText()}
          </text>
        )}
      </box>
    </Show>
  );
}

function StatusLine(props: {
  ctx: Ctx;
  quota: QuotaState;
  sessionID?: string;
}) {
  createEffect(() => {
    void props.quota.resolveSession(props.sessionID);
  });

  const visible = () => {
    if (sessionCachePart(props.ctx, props.sessionID)) return true;

    const state = props.quota.state();
    if (state.status === "ready") return state.line.text.length > 0;
    return state.status === "loading" || state.status === "unavailable";
  };

  const dimensions = useTerminalDimensions();
  // The session view pads its content by 1 or 2 columns, by terminal width; the
  // same padding lines the quota up under the footer's path.
  const gutter = () => (dimensions().width < 44 ? 1 : 2);

  // Left-aligned: this line spans the whole app width, sidebar included, and
  // whether the sidebar shows is internal to the session view. Starting under
  // the footer's path keeps the quota in the main column either way.
  return (
    <Show when={visible()}>
      <box
        flexDirection="row"
        justifyContent="flex-start"
        width="100%"
        flexShrink={0}
        // The session view ends with an empty padding row (paddingBottom 1):
        // move up onto it, so the line sits right under the prompt footer.
        // Only drawn inside a session, where that row always exists.
        marginTop={-1}
        paddingLeft={gutter()}
        paddingRight={gutter()}
      >
        <CompactStatusLine ctx={props.ctx} state={props.quota.state} sessionID={props.sessionID} />
      </box>
    </Show>
  );
}

/**
 * The `app` slot is global: it renders under every route. The HUD only has
 * something to say inside a session, so it follows the router.
 */
function AppLine(props: { ctx: Ctx; quota: QuotaState }) {
  const sessionID = () => {
    const route = props.ctx.ui.router.current();
    return route.type === "session" ? route.sessionID : undefined;
  };
  return (
    <Show when={sessionID()}>
      {(id: () => string) => <StatusLine ctx={props.ctx} quota={props.quota} sessionID={id()} />}
    </Show>
  );
}

export default Plugin.define({
  id,
  setup: (ctx) => {
    const quota = createQuotaState(ctx);

    // A line of its own at the very bottom, under opencode's prompt footer.
    // The prompt.footer slots all sit inside the footer's single row: anything
    // placed there shares it and squeezes the host's status ("esc interrupt").
    // The `app` slot comes after the whole route area in the app's column, so
    // a line there lands below everything, and the space above the prompt is
    // left to other plugins (opencode-todos).
    const unclaim = ctx.ui.slot({
      append: "app",
      render: () => <AppLine ctx={ctx} quota={quota} />,
    });

    return () => {
      unclaim();
      quota.dispose();
    };
  },
});
