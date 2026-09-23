import { describe, expect, it } from "bun:test";
import { createGitSource, deriveGitState, GIT_REFRESH_EVENTS, type GitState } from "../src/hud/git";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("deriveGitState", () => {
  it("is no-repo outside a repository", () => {
    expect(deriveGitState(undefined, undefined)).toEqual({ status: "no-repo" });
    expect(deriveGitState({ branch: { current: "main" } }, 0)).toEqual({ status: "no-repo" });
  });

  it("is no-repo on a detached head, where there is no branch to show", () => {
    expect(deriveGitState({ provider: "git", branch: {} }, 0)).toEqual({ status: "no-repo" });
  });

  it("reports clean and dirty trees", () => {
    expect(deriveGitState({ provider: "git", branch: { current: "main" } }, 0)).toEqual({
      status: "ready",
      branch: "main",
      dirty: false,
    });
    expect(deriveGitState({ provider: "git", branch: { current: "feat" } }, 3)).toEqual({
      status: "ready",
      branch: "feat",
      dirty: true,
    });
  });
});

function harness(overrides: { provider?: string; changed?: number } = {}) {
  const handlers = new Map<string, () => void>();
  const states: GitState[] = [];
  let statusCalls = 0;
  let changed = overrides.changed ?? 0;
  const source = createGitSource({
    info: () => ({ provider: overrides.provider ?? "git", branch: { current: "main" } }),
    syncInfo: async () => {},
    changedFiles: async () => {
      statusCalls += 1;
      return changed;
    },
    subscribe: (type, handler) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    onState: (state) => states.push(state),
    debounceMs: 5,
    pollMs: 60_000,
  });
  return {
    source,
    handlers,
    states,
    statusCalls: () => statusCalls,
    setChanged: (n: number) => (changed = n),
  };
}

describe("createGitSource", () => {
  it("publishes the state once on start", async () => {
    const h = harness({ changed: 2 });
    await sleep(10);
    expect(h.states.at(-1)).toEqual({ status: "ready", branch: "main", dirty: true });
    h.source.dispose();
  });

  it("subscribes to every refresh event", () => {
    const h = harness();
    expect([...h.handlers.keys()].sort()).toEqual([...GIT_REFRESH_EVENTS].sort());
    h.source.dispose();
  });

  it("refreshes after a filesystem change", async () => {
    const h = harness({ changed: 0 });
    await sleep(10);
    h.setChanged(1);
    h.handlers.get("filesystem.changed")?.();
    await sleep(20);
    expect(h.states.at(-1)).toEqual({ status: "ready", branch: "main", dirty: true });
    h.source.dispose();
  });

  it("collapses a burst of events into one status call", async () => {
    const h = harness();
    await sleep(10);
    const before = h.statusCalls();
    for (let i = 0; i < 20; i++) h.handlers.get("filesystem.changed")?.();
    await sleep(25);
    expect(h.statusCalls() - before).toBe(1);
    h.source.dispose();
  });

  it("does not ask for status outside a repository", async () => {
    const h = harness({ provider: "" });
    await sleep(10);
    expect(h.statusCalls()).toBe(0);
    expect(h.states.at(-1)).toEqual({ status: "no-repo" });
    h.source.dispose();
  });

  it("re-reads the state on demand, as after a location switch", async () => {
    const h = harness({ changed: 0 });
    await sleep(10);
    h.setChanged(4);
    h.source.refresh();
    await sleep(20);
    expect(h.states.at(-1)).toEqual({ status: "ready", branch: "main", dirty: true });
    h.source.dispose();
  });

  it("unsubscribes and stays quiet after dispose", async () => {
    const h = harness();
    await sleep(10);
    h.source.dispose();
    expect(h.handlers.size).toBe(0);
    const count = h.states.length;
    await sleep(20);
    expect(h.states.length).toBe(count);
  });
});
