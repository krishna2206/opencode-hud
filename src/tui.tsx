/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { createEffect, createSignal, Show } from "solid-js";
import type { Provider, SessionModelMeta } from "./providers/types.js";
import { antigravityProvider } from "./providers/antigravity/index.js";
import { opencodeGoProvider } from "./providers/opencode-go/index.js";
import { collectQuota, type CollectResult } from "./refresh/collect.js";
import { createRefreshLifecycle } from "./refresh/lifecycle.js";
import {
  buildCompactLine,
  COMPACT_LOADING_TEXT,
  COMPACT_UNAVAILABLE_TEXT,
  formatSessionCachePart,
  type CompactLine,
  type CompactPart,
} from "./tui/compact.js";
import type { GitState } from "./tui/git.js";
import { createGitStatusWatcher } from "./tui/git.js";

const id = "opencode-hud";
const COMPACT_ORDER = 90;

const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DELAYS_MS = [150, 600] as const;
const MOUNT_RECOVERY_DELAYS_MS = [500, 1_500, 4_000] as const;
const REQUEST_TIMEOUT_MS = 5_000;

const COMPACT_PERCENT_WARNING_THRESHOLD = 50;
const COMPACT_PERCENT_ERROR_THRESHOLD = 20;

const PROVIDERS: readonly Provider[] = [antigravityProvider, opencodeGoProvider];

type TuiPromptRefCallback = (ref: TuiPromptRef | undefined) => void;

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
 * Resolve the model in use for a session. Order: TUI session state, then the
 * client lookup, then the last assistant message. Returns {} when unknown.
 */
async function getTuiSessionModelMeta(api: TuiPluginApi, sessionID: string): Promise<SessionModelMeta> {
  const stateSession = api.state.session as { get?: (sessionID: string) => unknown };
  try {
    const meta = extractSessionModelMeta(stateSession.get?.(sessionID));
    if (meta.providerID || meta.modelID) return meta;
  } catch {
    // fall through to the client below
  }

  try {
    const sessionGet = (
      api.client.session as {
        get?: (params: { sessionID: string }) => Promise<{ data?: unknown }>;
      }
    ).get;
    const response = await sessionGet?.({ sessionID });
    const meta = extractSessionModelMeta(response?.data);
    if (meta.providerID || meta.modelID) return meta;
  } catch {
    // fall through to message state below
  }

  const messages = api.state.session.messages(sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] as unknown;
    if (!item || typeof item !== "object") continue;
    const record = item as { role?: string; providerID?: string; modelID?: string };
    if (record.role === "assistant" && (record.providerID || record.modelID)) {
      return { providerID: record.providerID, modelID: record.modelID };
    }
  }

  return {};
}

function activeProviders(activeIds: string[]): Provider[] {
  return PROVIDERS.filter((provider) => activeIds.includes(provider.id));
}

interface QuotaStateHandle {
  state: () => CompactState;
  resolveSession: (sessionID: string) => Promise<void>;
}

const quotaStates = new WeakMap<TuiPluginApi, QuotaStateHandle>();

function getQuotaState(api: TuiPluginApi): QuotaStateHandle {
  const existing = quotaStates.get(api);
  if (existing) return existing;

  const [state, setState] = createSignal<CompactState>({ status: "disabled" });
  const [activeIds, setActiveIds] = createSignal<string[]>([]);
  let previous: CompactState = { status: "disabled" };
  let appliedIds = new Set<string>();
  let resolveVersion = 0;

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
      api.event.on("session.updated" as never, () => scheduleRefresh()),
      api.event.on("message.updated" as never, () => scheduleRefresh()),
      api.event.on("message.removed" as never, () => scheduleRefresh()),
      api.event.on("tui.session.select" as never, () => scheduleRefresh()),
    ],
  });

  const handle: QuotaStateHandle = {
    state,
    resolveSession: async (sessionID: string) => {
      const version = ++resolveVersion;
      if (!sessionID) {
        setActiveIds([]);
        lifecycle.reload();
        return;
      }

      const meta = await getTuiSessionModelMeta(api, sessionID);
      if (version !== resolveVersion) return;

      const ids = PROVIDERS.filter((provider) => provider.matchesModel(meta)).map(
        (provider) => provider.id,
      );
      setActiveIds(ids);
      lifecycle.reload();
    },
  };

  api.lifecycle.onDispose(lifecycle.dispose);
  quotaStates.set(api, handle);
  return handle;
}

/**
 * Prompt-cache stats from the most recent assistant step of the session.
 * Uses the last assistant message's token usage (per-step) rather than the
 * session cumulative counters, so a cache regression is visible immediately.
 * Returns null when no assistant message has usable token data yet.
 */
function lastStepCachePart(api: TuiPluginApi, sessionID: string): {
  text: string;
  hitRatio: number;
  cachedTokens: number;
} | null {
  const messages = api.state.session.messages(sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as unknown;
    if (!message || typeof message !== "object") continue;
    const record = message as {
      role?: string;
      tokens?: { input?: number; cache?: { read?: number } };
    };
    if (record.role !== "assistant") continue;
    const input = record.tokens?.input ?? 0;
    const cacheRead = record.tokens?.cache?.read ?? 0;
    if (input <= 0 && cacheRead <= 0) continue;
    return formatSessionCachePart(input, cacheRead);
  }
  return null;
}

function compactPartColor(part: CompactPart, theme: TuiPluginApi["theme"]["current"]): RGBA | undefined {
  if (part.kind === "error") return theme.error;

  if (part.kind === "percent") {
    const remaining = part.percentRemaining;
    if (Number.isFinite(remaining)) {
      if (remaining >= COMPACT_PERCENT_WARNING_THRESHOLD) return theme.success;
      if (remaining >= COMPACT_PERCENT_ERROR_THRESHOLD) return theme.warning;
      return theme.error;
    }
  }

  if (part.kind === "cache") {
    if (part.hitRatio >= 50) return theme.success;
    if (part.hitRatio > 0) return theme.warning;
    return theme.textMuted;
  }

  return theme.textMuted;
}

function CompactStatusLine(props: {
  api: TuiPluginApi;
  state: () => CompactState;
  sessionID?: string;
}) {
  const parts = () => {
    const state = props.state();
    if (state.status !== "ready") return [];

    const baseParts = [...state.line.parts];

    // Live prompt-cache stats from the last assistant step (rendered if cache hit > 0%)
    if (props.sessionID) {
      try {
        const cachePart = lastStepCachePart(props.api, props.sessionID);
        if (cachePart) {
          baseParts.push(
            { kind: "separator", text: " · " },
            {
              kind: "cache",
              text: cachePart.text,
              hitRatio: cachePart.hitRatio,
              cachedTokens: cachePart.cachedTokens,
            },
          );
        }
      } catch {
        // ignore
      }
    }

    return baseParts;
  };

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
            <text fg={compactPartColor(part, props.api.theme.current)} wrapMode="none">
              {part.text}
            </text>
          ))
        ) : (
          <text fg={props.api.theme.current.textMuted} wrapMode="none">
            {mutedText()}
          </text>
        )}
      </box>
    </Show>
  );
}

function GitLine(props: { api: TuiPluginApi; git: () => GitState }) {
  const segments = () => {
    const state = props.git();
    if (state.status !== "ready") return [];

    const fg = state.dirty ? props.api.theme.current.warning : props.api.theme.current.success;
    const symbol = state.dirty ? "●" : "✓";
    return [
      { text: "⎇", fg },
      { text: `  ${state.branch}`, fg },
      { text: ` ${symbol}`, fg },
    ];
  };

  return (
    <Show when={segments().length > 0}>
      <box flexDirection="row">
        {segments().map((segment) => (
          <text fg={segment.fg} wrapMode="none">
            {segment.text}
          </text>
        ))}
      </box>
    </Show>
  );
}

function StatusLine(props: {
  api: TuiPluginApi;
  compact: () => CompactState;
  git: () => GitState;
  sessionID?: string;
}) {
  const visible = () => {
    if (props.git().status === "ready") return true;

    const state = props.compact();
    if (state.status === "ready") return state.line.text.length > 0;
    return state.status === "loading" || state.status === "unavailable";
  };

  return (
    <Show when={visible()}>
      <box
        flexDirection="row"
        justifyContent={props.git().status === "ready" ? "space-between" : "flex-end"}
        width="100%"
      >
        <GitLine api={props.api} git={props.git} />
        <CompactStatusLine api={props.api} state={props.compact} sessionID={props.sessionID} />
      </box>
    </Show>
  );
}

function SessionPromptWithStatus(props: {
  api: TuiPluginApi;
  sessionID: string;
  quota: QuotaStateHandle;
  git: () => GitState;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  promptRef?: TuiPromptRefCallback;
}) {
  createEffect(() => {
    void props.quota.resolveSession(props.sessionID);
  });

  return (
    <box gap={0} width="100%">
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={props.promptRef}
      />
      <StatusLine api={props.api} compact={props.quota.state} git={props.git} sessionID={props.sessionID} />
    </box>
  );
}

const gitStates = new WeakMap<TuiPluginApi, () => GitState>();

function setupGitState(api: TuiPluginApi): () => GitState {
  const [state, setState] = createSignal<GitState>({ status: "no-repo" });
  gitStates.set(api, state);

  const worktree = api.state.path.worktree;
  const directory = api.state.path.directory;
  const gitRoot =
    worktree && worktree !== "/"
      ? worktree
      : directory && directory !== "/"
        ? directory
        : undefined;

  if (gitRoot) {
    const watcher = createGitStatusWatcher({
      worktree: gitRoot,
      subscribe: (type, handler) => api.event.on(type as never, handler),
      onState: setState,
    });
    api.lifecycle.onDispose(watcher.dispose);
  }

  return state;
}

function registerStableTuiSlots(api: TuiPluginApi, git: () => GitState): void {
  const quota = getQuotaState(api);

  api.slots.register({
    order: COMPACT_ORDER,
    slots: {
      session_prompt(
        _ctx,
        props: {
          session_id: string;
          visible?: boolean;
          disabled?: boolean;
          on_submit?: () => void;
          ref?: TuiPromptRefCallback;
        },
      ) {
        return (
          <SessionPromptWithStatus
            api={api}
            sessionID={props.session_id}
            quota={quota}
            git={git}
            visible={props.visible}
            disabled={props.disabled}
            onSubmit={props.on_submit}
            promptRef={props.ref}
          />
        );
      },
    },
  });
}

const tui: TuiPlugin = async (api) => {
  const git = setupGitState(api);
  registerStableTuiSlots(api, git);
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default pluginModule;