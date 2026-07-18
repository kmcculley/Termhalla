/** A started timer that can be stopped. Returned by the start helpers below so services hold an
 *  opaque handle instead of the raw timer + copy-pasted `unref` incantation. */
export interface ManagedTimer { stop(): void }

/** `unref` exists on Node's Timeout but not on the renderer-typed numeric handle, hence the
 *  feature-test — same cast the services previously inlined at every call site. */
function unrefTimer(timer: unknown): void {
  ;(timer as { unref?: () => void }).unref?.()
}

/**
 * `setInterval` + `unref` in one place, shared by the polling services (status engine, process
 * tracker, cloud status, search indexer): a scheduled poll must never keep the main process alive
 * on its own, or an app quit with a poll still pending would hang shutdown. `stop()` is idempotent.
 */
export function startUnrefedInterval(fn: () => void, ms: number): ManagedTimer {
  const timer = setInterval(fn, ms)
  unrefTimer(timer)
  return { stop: () => clearInterval(timer as Parameters<typeof clearInterval>[0]) }
}

/** `setTimeout` counterpart (git-status debounce). Same unref rationale; `stop()` cancels a
 *  pending fire and is idempotent. */
export function startUnrefedTimeout(fn: () => void, ms: number): ManagedTimer {
  const timer = setTimeout(fn, ms)
  unrefTimer(timer)
  return { stop: () => clearTimeout(timer as Parameters<typeof clearTimeout>[0]) }
}
