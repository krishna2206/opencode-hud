import { describe, expect, it } from "bun:test";
import {
  createGitStatusWatcher,
  isIgnoredPath,
  type GitEventSubscribe,
  type GitState,
  type GitStatusResult,
} from "../src/tui/git.js";

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeBus() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();

  const subscribe: GitEventSubscribe = (type, handler) => {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  };

  return {
    subscribe,
    emit: (type: string, event?: unknown) => {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
    listeners: (type: string) => handlers.get(type)?.size ?? 0,
  };
}

function fileEvent(file: string) {
  return { type: "file.watcher.updated", properties: { file, event: "change" } };
}

describe("isIgnoredPath", () => {
  it("ignores build and dependency directories at any depth", () => {
    expect(isIgnoredPath("node_modules/foo/index.js")).toBe(true);
    expect(isIgnoredPath("packages/app/node_modules/foo.js")).toBe(true);
    expect(isIgnoredPath(".next/dev/build/chunk.js")).toBe(true);
    expect(isIgnoredPath("apps/web/.next/server/page.js")).toBe(true);
    expect(isIgnoredPath("dist/index.js")).toBe(true);
    expect(isIgnoredPath("target/debug/app")).toBe(true);
    expect(isIgnoredPath("api/__pycache__/mod.cpython-311.pyc")).toBe(true);
  });

  it("keeps source files, including look-alike names", () => {
    expect(isIgnoredPath("src/tui/git.ts")).toBe(false);
    expect(isIgnoredPath("README.md")).toBe(false);
    expect(isIgnoredPath("src/dist-helpers.ts")).toBe(false);
    expect(isIgnoredPath("scripts/build.mjs")).toBe(false);
    expect(isIgnoredPath("build/script.sh")).toBe(false);
    expect(isIgnoredPath(undefined)).toBe(false);
    expect(isIgnoredPath("")).toBe(false);
  });
});

describe("createGitStatusWatcher", () => {
  const ready: GitStatusResult = { branch: "main", dirty: false };

  it("shuts itself down outside a repository", async () => {
    const bus = makeBus();
    let runs = 0;
    const states: GitState[] = [];

    createGitStatusWatcher({
      worktree: "/Users/krishna",
      subscribe: bus.subscribe,
      onState: (state) => states.push(state),
      run: async () => {
        runs += 1;
        return null;
      },
      debounceMs: 5,
    });

    await tick(10);

    expect(runs).toBe(1);
    expect(states).toEqual([{ status: "no-repo" }]);
    expect(bus.listeners("file.edited")).toBe(0);
    expect(bus.listeners("file.watcher.updated")).toBe(0);
    expect(bus.listeners("vcs.branch.updated")).toBe(0);

    // Whatever happens next must not spawn anything.
    bus.emit("file.edited");
    bus.emit("file.watcher.updated", fileEvent("src/index.ts"));
    await tick(20);
    expect(runs).toBe(1);
  });

  it("ignores watcher noise from build directories", async () => {
    const bus = makeBus();
    let runs = 0;

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: () => {},
      run: async () => {
        runs += 1;
        return ready;
      },
      debounceMs: 5,
    });

    await tick(10);
    expect(runs).toBe(1);

    for (let i = 0; i < 50; i += 1) {
      bus.emit("file.watcher.updated", fileEvent(`.next/dev/build/chunk-${i}.js`));
    }
    await tick(20);
    expect(runs).toBe(1);

    bus.emit("file.watcher.updated", fileEvent("src/index.ts"));
    await tick(20);
    expect(runs).toBe(2);
  });

  it("still refreshes when opencode edits an otherwise ignored path", async () => {
    const bus = makeBus();
    let runs = 0;

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: () => {},
      run: async () => {
        runs += 1;
        return ready;
      },
      debounceMs: 5,
    });

    await tick(10);
    expect(runs).toBe(1);

    bus.emit("file.edited", { type: "file.edited", properties: { file: "dist/index.js" } });
    await tick(20);
    expect(runs).toBe(2);
  });

  it("collapses a burst of source events into a single run", async () => {
    const bus = makeBus();
    let runs = 0;

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: () => {},
      run: async () => {
        runs += 1;
        return ready;
      },
      debounceMs: 20,
    });

    await tick(5);
    expect(runs).toBe(1);

    for (let i = 0; i < 30; i += 1) {
      bus.emit("file.watcher.updated", fileEvent(`src/file-${i}.ts`));
    }
    await tick(60);

    expect(runs).toBe(2);
  });

  it("emits only when the branch or dirty flag actually changed", async () => {
    const bus = makeBus();
    const states: GitState[] = [];
    let dirty = false;

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: (state) => states.push(state),
      run: async () => ({ branch: "main", dirty }),
      debounceMs: 5,
    });

    await tick(10);
    expect(states).toHaveLength(1);

    // Three refreshes, same result: the signal must stay quiet.
    for (let i = 0; i < 3; i += 1) {
      bus.emit("file.edited");
      await tick(15);
    }
    expect(states).toHaveLength(1);

    dirty = true;
    bus.emit("file.edited");
    await tick(15);

    expect(states).toHaveLength(2);
    expect(states[1]).toEqual({ status: "ready", branch: "main", dirty: true });
  });

  it("shows a new branch immediately, before git confirms it", async () => {
    const bus = makeBus();
    const states: GitState[] = [];

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: (state) => states.push(state),
      run: async () => ({ branch: "main", dirty: true }),
      debounceMs: 50,
    });

    await tick(10);
    expect(states).toEqual([{ status: "ready", branch: "main", dirty: true }]);

    bus.emit("vcs.branch.updated", {
      type: "vcs.branch.updated",
      properties: { branch: "feature" },
    });

    // No git run yet — the name came straight from the event payload.
    expect(states[1]).toEqual({ status: "ready", branch: "feature", dirty: true });
  });

  it("never runs two git processes at once", async () => {
    const bus = makeBus();
    let running = 0;
    let maxConcurrent = 0;

    createGitStatusWatcher({
      worktree: "/repo",
      subscribe: bus.subscribe,
      onState: () => {},
      run: async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await tick(15);
        running -= 1;
        return ready;
      },
      debounceMs: 1,
    });

    for (let i = 0; i < 20; i += 1) {
      bus.emit("file.edited");
      await tick(2);
    }
    await tick(60);

    expect(maxConcurrent).toBe(1);
  });
});
