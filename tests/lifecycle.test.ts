import { describe, expect, it } from "bun:test";
import { createRefreshLifecycle } from "../src/refresh/lifecycle.js";
import { throttleLeading } from "../src/refresh/throttle.js";

/** Let pending timers fire and the promise chain settle. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("throttleLeading", () => {
  it("runs on the first call and collapses the rest of the window", () => {
    let now = 0;
    let calls = 0;
    const throttled = throttleLeading(() => { calls += 1; }, 1_000, () => now);

    throttled();
    expect(calls).toBe(1);

    for (let i = 0; i < 100; i += 1) throttled();
    expect(calls).toBe(1);

    now = 999;
    throttled();
    expect(calls).toBe(1);

    now = 1_000;
    throttled();
    expect(calls).toBe(2);
  });
});

describe("createRefreshLifecycle", () => {
  it("arms at most one timer per delay, whatever the burst size", async () => {
    let schedule: () => void = () => {};

    const lifecycle = createRefreshLifecycle({
      load: async () => "value",
      apply: () => {},
      intervalMs: 60_000,
      eventRefreshDelaysMs: [10, 40],
      subscribe: (scheduleRefresh) => {
        schedule = scheduleRefresh;
        return [];
      },
    });

    // A streaming response produces bursts of this shape.
    for (let i = 0; i < 200; i += 1) schedule();

    expect(lifecycle.stats.scheduled).toBe(200);
    expect(lifecycle.stats.timersCreated).toBe(2);
    expect(lifecycle.stats.pendingTimers).toBe(2);

    await tick(80);
    expect(lifecycle.stats.pendingTimers).toBe(0);

    lifecycle.dispose();
  });

  it("re-arms a delay once its timer has fired", async () => {
    let schedule: () => void = () => {};

    const lifecycle = createRefreshLifecycle({
      load: async () => "value",
      apply: () => {},
      intervalMs: 60_000,
      eventRefreshDelaysMs: [10],
      subscribe: (scheduleRefresh) => {
        schedule = scheduleRefresh;
        return [];
      },
    });

    schedule();
    schedule();
    expect(lifecycle.stats.timersCreated).toBe(1);

    await tick(30);
    schedule();
    expect(lifecycle.stats.timersCreated).toBe(2);

    lifecycle.dispose();
  });

  it("never runs two loads concurrently", async () => {
    let schedule: () => void = () => {};
    let running = 0;
    let maxConcurrent = 0;

    const lifecycle = createRefreshLifecycle({
      load: async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await tick(5);
        running -= 1;
        return "value";
      },
      apply: () => {},
      intervalMs: 60_000,
      eventRefreshDelaysMs: [1, 2],
      subscribe: (scheduleRefresh) => {
        schedule = scheduleRefresh;
        return [];
      },
    });

    for (let i = 0; i < 50; i += 1) schedule();
    await tick(60);

    expect(maxConcurrent).toBe(1);

    lifecycle.dispose();
  });

  it("stops every timer and unsubscribes on dispose", async () => {
    let schedule: () => void = () => {};
    let unsubscribed = 0;
    let loadsBeforeDispose = 0;

    const lifecycle = createRefreshLifecycle({
      load: async () => "value",
      apply: () => {},
      intervalMs: 60_000,
      eventRefreshDelaysMs: [10],
      subscribe: (scheduleRefresh) => {
        schedule = scheduleRefresh;
        return [() => { unsubscribed += 1; }];
      },
    });

    schedule();
    loadsBeforeDispose = lifecycle.stats.loads;
    lifecycle.dispose();

    expect(unsubscribed).toBe(1);
    expect(lifecycle.stats.pendingTimers).toBe(0);

    await tick(40);
    expect(lifecycle.stats.loads).toBe(loadsBeforeDispose);
  });
});
