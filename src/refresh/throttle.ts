/**
 * Leading-edge throttle.
 *
 * Used for `message.updated`, which fires continuously while a response
 * streams. Quota does not change token by token, so collapsing the burst into
 * one call per window is not a degradation — it is what the event should have
 * meant. Accuracy at the end of a turn is guaranteed separately by
 * `session.idle`, which is why no trailing call is needed here.
 *
 * The clock is injectable so tests do not have to wait in real time.
 */
export function throttleLeading(
  fn: () => void,
  windowMs: number,
  now: () => number = Date.now,
): () => void {
  let lastRun = Number.NEGATIVE_INFINITY;

  return () => {
    const current = now();
    if (current - lastRun < windowMs) return;
    lastRun = current;
    fn();
  };
}
