/**
 * Git status watcher: shows the current branch + dirty state.
 *
 * Runs `git status --porcelain --branch` in the worktree and refreshes on
 * opencode events (branch change, file edits). Independent of any quota logic.
 *
 * Three things keep this from spawning processes for nothing:
 *
 * - Outside a repository the watcher shuts itself down after the first result,
 *   instead of respawning a failing `git status` on every file event.
 * - `file.watcher.updated` carries the changed path, so build and dependency
 *   directories are filtered out. A dev server rewriting `.next/` no longer
 *   drives a `git status` twice a second.
 * - Only one `git status` runs at a time; overlapping requests collapse into a
 *   single follow-up run.
 */

import { execFile } from "node:child_process";

export type GitState = { status: "no-repo" } | { status: "ready"; branch: string; dirty: boolean };

export interface GitStatusResult {
  branch: string;
  dirty: boolean;
}

export type GitEventSubscribe = (type: string, handler: (event: unknown) => void) => () => void;

const GIT_TIMEOUT_MS = 3_000;
const GIT_DEBOUNCE_MS = 500;

/**
 * Directory names whose contents cannot flip the dirty flag, because they are
 * gitignored wherever they exist. Deliberately conservative: `build`, `out` and
 * `vendor` are left out because projects do track them.
 *
 * A wrong entry here would only ever delay the indicator, never corrupt it, and
 * only for changes seen by the OS watcher — `file.edited` is never filtered.
 */
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  "dist",
  "target",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  ".gradle",
]);

/** Whether a changed path lives under a directory git will never report. */
export function isIgnoredPath(file: string | undefined): boolean {
  if (!file) return false;
  for (const segment of file.split("/")) {
    if (segment && IGNORED_SEGMENTS.has(segment)) return true;
  }
  return false;
}

function readProperty(event: unknown, key: string): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const properties = (event as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") return undefined;
  const value = (properties as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function sameState(a: GitState, b: GitState): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "ready" || b.status !== "ready") return true;
  return a.branch === b.branch && a.dirty === b.dirty;
}

function parseBranchAndDirty(output: string): GitStatusResult | null {
  const lines = output.split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (!header?.startsWith("## ")) return null;

  let branch = header.slice(3).trim();
  const separator = branch.search(/[.[\s]/u);
  if (separator !== -1) branch = branch.slice(0, separator);
  if (!branch || branch === "HEAD") return null;

  return { branch, dirty: lines.length > 1 };
}

function runGitStatus(worktree: string): Promise<GitStatusResult | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", worktree, "status", "--porcelain", "--branch"],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseBranchAndDirty(stdout));
      },
    );
  });
}

export function createGitStatusWatcher(params: {
  worktree: string;
  subscribe: GitEventSubscribe;
  onState: (state: GitState) => void;
  /** Injectable runner, so tests never spawn a real process. */
  run?: (worktree: string) => Promise<GitStatusResult | null>;
  /** Injectable debounce, so tests do not wait half a second per assertion. */
  debounceMs?: number;
}): { refresh: () => void; dispose: () => void } {
  const run = params.run ?? runGitStatus;
  const debounceMs = params.debounceMs ?? GIT_DEBOUNCE_MS;

  let disposed = false;
  let inFlight = false;
  let pending = false;
  let settled = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let last: GitState | undefined;

  // Signal only on a real change: the previous implementation handed Solid a
  // fresh object every time, so an unchanged status still notified subscribers
  // and invalidated the status line.
  const emit = (next: GitState): void => {
    if (last && sameState(last, next)) return;
    last = next;
    params.onState(next);
  };

  const dispose = (): void => {
    if (disposed) return;

    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = undefined;
    for (const unsubscribe of disposers) unsubscribe();
  };

  const refresh = (): void => {
    if (disposed) return;

    if (inFlight) {
      pending = true;
      return;
    }

    inFlight = true;
    void run(params.worktree)
      .then((result) => {
        if (disposed) return;

        const wasFirstResult = !settled;
        settled = true;
        emit(result ? { status: "ready", ...result } : { status: "no-repo" });

        // Not a repository: nothing here will ever become one during this
        // session, so stop listening instead of failing once per file event.
        if (wasFirstResult && !result) dispose();
      })
      .catch(() => {
        // `run` resolves rather than rejects; keep the last state if it ever does.
      })
      .finally(() => {
        inFlight = false;
        if (disposed) return;
        if (pending) {
          pending = false;
          refresh();
        }
      });
  };

  const schedule = (): void => {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      refresh();
    }, debounceMs);
  };

  const disposers = [
    params.subscribe("vcs.branch.updated", (event) => {
      // The event carries the new branch, so the name can change right away
      // while the dirty flag catches up with the debounced `git status`.
      const branch = readProperty(event, "branch");
      if (branch && last?.status === "ready" && last.branch !== branch) {
        emit({ status: "ready", branch, dirty: last.dirty });
      }
      schedule();
    }),
    // Never filtered: opencode edited this file on purpose, and it may well sit
    // under a directory the OS-watcher filter ignores.
    params.subscribe("file.edited", () => schedule()),
    params.subscribe("file.watcher.updated", (event) => {
      if (isIgnoredPath(readProperty(event, "file"))) return;
      schedule();
    }),
  ];

  refresh();

  return { refresh, dispose };
}
