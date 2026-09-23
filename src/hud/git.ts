/**
 * Git state for the HUD, read from the opencode server instead of a `git`
 * subprocess.
 *
 * The branch comes from the location's VCS info, pushed by `vcs.branch.updated`;
 * dirtiness is whether the server's `vcs.status` reports any changed file. The
 * server owns the repository watcher, so the TUI no longer spawns `git status`
 * on file events, and outside a repository there is nothing to poll: the VCS
 * info carries no provider and the state stays "no-repo".
 */

export type GitState = { status: "no-repo" } | { status: "ready"; branch: string; dirty: boolean };

export interface VcsInfoLike {
  readonly provider?: string;
  readonly branch?: { readonly current?: string };
}

/** Pure derivation, kept separate so it can be tested without a server. */
export function deriveGitState(info: VcsInfoLike | undefined, changedFiles: number | undefined): GitState {
  const branch = info?.branch?.current;
  if (!info?.provider || !branch) return { status: "no-repo" };
  return { status: "ready", branch, dirty: (changedFiles ?? 0) > 0 };
}

export interface GitSourceOptions {
  /** Current VCS info for the active location, or undefined outside a repository. */
  readonly info: () => VcsInfoLike | undefined;
  /** Refreshes the VCS info from the server. */
  readonly syncInfo: () => Promise<void>;
  /** Number of files the server reports as changed. */
  readonly changedFiles: () => Promise<number>;
  /** Subscribes to a server event and returns the unsubscribe function. */
  readonly subscribe: (type: string, handler: () => void) => () => void;
  readonly onState: (state: GitState) => void;
  /** Safety net only: filesystem.changed already covers edits made outside opencode. */
  readonly pollMs?: number;
  readonly debounceMs?: number;
}

const DEFAULT_POLL_MS = 120_000;
const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Events after which the working tree may have changed: a branch switch, any
 * change the server's filesystem watcher sees (the agent's edits and the
 * user's alike), and the end of a turn as a backstop. Bursts are debounced into
 * one `vcs.status` call.
 */
export const GIT_REFRESH_EVENTS = ["vcs.branch.updated", "filesystem.changed", "session.idle"] as const;

export function createGitSource(options: GitSourceOptions): { dispose: () => void } {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const refresh = async () => {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      try {
        await options.syncInfo().catch(() => {});
        const info = options.info();
        const changed = info?.provider ? await options.changedFiles().catch(() => undefined) : undefined;
        if (!disposed) options.onState(deriveGitState(info, changed));
      } finally {
        running = undefined;
        if (again && !disposed) {
          again = false;
          void refresh();
        }
      }
    })();
    await running;
  };

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  };

  const unsubscribers = GIT_REFRESH_EVENTS.map((type) => options.subscribe(type, schedule));
  const poll = setInterval(() => void refresh(), options.pollMs ?? DEFAULT_POLL_MS);
  void refresh();

  return {
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
