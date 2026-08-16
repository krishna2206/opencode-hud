/**
 * Git status watcher: shows the current branch + dirty state.
 *
 * Runs `git status --porcelain --branch` in the worktree and refreshes on
 * opencode events (branch change, file edits). Independent of any quota logic.
 */

import { execFile } from "node:child_process";

export type GitState = { status: "no-repo" } | { status: "ready"; branch: string; dirty: boolean };

export type GitEventSubscribe = (type: string, handler: (event: unknown) => void) => () => void;

const GIT_TIMEOUT_MS = 3_000;
const GIT_DEBOUNCE_MS = 500;

function parseBranchAndDirty(output: string): { branch: string; dirty: boolean } | null {
  const lines = output.split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (!header?.startsWith("## ")) return null;

  let branch = header.slice(3).trim();
  const separator = branch.search(/[.[\s]/u);
  if (separator !== -1) branch = branch.slice(0, separator);
  if (!branch || branch === "HEAD") return null;

  return { branch, dirty: lines.length > 1 };
}

function runGitStatus(worktree: string): Promise<{ branch: string; dirty: boolean } | null> {
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
}): { refresh: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const refresh = (): void => {
    void (async () => {
      if (disposed) return;
      const result = await runGitStatus(params.worktree);
      if (disposed) return;
      params.onState(result ? { status: "ready", ...result } : { status: "no-repo" });
    })();
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, GIT_DEBOUNCE_MS);
  };

  const disposers = [
    params.subscribe("vcs.branch.updated", () => refresh()),
    params.subscribe("file.edited", () => schedule()),
    params.subscribe("file.watcher.updated", () => schedule()),
  ];

  refresh();

  return {
    refresh,
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const dispose of disposers) dispose();
    },
  };
}