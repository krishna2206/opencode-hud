/**
 * Refresh lifecycle: decides when to re-collect and how to survive failures.
 *
 * Timeline:
 * - initial load + a few recovery attempts after mount
 * - fixed interval refresh
 * - refresh shortly after relevant opencode events
 *
 * Failure policy: the load promise never throws (providers return errors in
 * their result). If the collect yields no usable entries, the renderer keeps
 * the last known state (no flicker between a value and "unavailable").
 */

export interface RefreshLifecycle {
  reload: () => void;
  dispose: () => void;
}

export interface RefreshLifecycleOptions<T> {
  load: () => Promise<T>;
  apply: (value: T) => void;
  intervalMs: number;
  eventRefreshDelaysMs: readonly number[];
  recoveryDelaysMs?: readonly number[];
  subscribe: (scheduleRefresh: () => void) => Array<() => void>;
}

export function createRefreshLifecycle<T>(options: RefreshLifecycleOptions<T>): RefreshLifecycle {
  let disposed = false;
  let inFlight = false;
  let queued = false;
  let loadVersion = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const reload = (): void => {
    if (disposed) return;

    if (inFlight) {
      queued = true;
      return;
    }

    inFlight = true;
    const currentVersion = ++loadVersion;

    void options
      .load()
      .then((next) => {
        if (disposed || currentVersion !== loadVersion) return;
        options.apply(next);
      })
      .catch(() => {
        // The collect already absorbs provider errors; reaching here means a
        // programming error or an unexpected rejection. Keep the last state.
        if (disposed || currentVersion !== loadVersion) return;
      })
      .finally(() => {
        if (disposed) return;
        inFlight = false;
        if (queued) {
          queued = false;
          reload();
        }
      });
  };

  const queueRefresh = (delay: number): void => {
    if (disposed) return;

    const timer = setTimeout(() => {
      timers.delete(timer);
      reload();
    }, delay);
    timers.add(timer);
  };

  const scheduleRefresh = (): void => {
    for (const delay of options.eventRefreshDelaysMs) queueRefresh(delay);
  };

  const interval = setInterval(reload, options.intervalMs);
  const unsubscribers = options.subscribe(scheduleRefresh);

  const dispose = (): void => {
    if (disposed) return;

    disposed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
  };

  reload();
  for (const delay of options.recoveryDelaysMs ?? []) queueRefresh(delay);

  return { reload, dispose };
}