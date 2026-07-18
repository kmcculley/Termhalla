/**
 * The pure drop-and-resnapshot backpressure policy (feature 0026, REQ-017). No I/O, no timers:
 * every trigger is an explicit caller signal (`onData`/`onDrain`/`onBuffered`), so it is fully
 * unit-testable and the drain-driven resync (CONV-036) can never depend on a chunk that might
 * never arrive.
 *
 * v2 (ESC-001; FINDING-002/019/020) extends the policy to cover EVERY message class, not only
 * pane `data`: `onPush`/`takeHeldPushes` coalesce `status`/`grid` pushes latest-wins per pane while
 * a client is saturated (so a saturated client never accumulates unbounded pushes), `clearStale`
 * lets a pane's backpressure state be reset by unsubscribe/paneExit/fresh-subscribe (so staleness
 * can never outlive its subscription), and `onBuffered`/`stalledPast` track how long a connection
 * has been CONTINUOUSLY saturated so the real transport wiring can terminate a connection that
 * never drains.
 */
import { PHONE_WS_HIGH_WATER, PHONE_WS_LOW_WATER } from './constants'

export interface HeldPush {
  kind: string
  paneId: string
  payload: unknown
}

export interface BackpressurePolicy {
  /** `true` = enqueue this chunk. Strictly above `highWater` drops and marks the pane stale;
   *  once stale, EVERY subsequent chunk for that pane is dropped (even if the buffer dips) until
   *  a drain resyncs it — enqueueing a mid-gap chunk would reorder the stream ahead of the resync. */
  onData(paneId: string, bufferedAmount: number): boolean
  /** Strictly below `lowWater`: returns every currently-stale pane exactly once and clears their
   *  staleness. At/above `lowWater`: returns `[]` (nothing resynced yet). */
  onDrain(bufferedAmount: number): string[]
  isStale(paneId: string): boolean
  /** `true` = send this status/grid push now. `false` = the push was HELD (coalesced latest-wins
   *  per `kind`+`paneId` — a saturated client accumulates at most one entry per pane per kind). */
  onPush(kind: string, paneId: string, payload: unknown, bufferedAmount: number): boolean
  /** Every held push, latest payload per (kind, paneId); clears the held set. */
  takeHeldPushes(): HeldPush[]
  /** unsubscribe / paneExit / fresh-subscribe hook: a pane's stale flag (and any held pushes for
   *  it) cannot outlive its subscription. A no-op on a never-stale/never-held pane. */
  clearStale(paneId: string): void
  /** Continuous-saturation sample (a real transport signal feeds this on a cadence). */
  onBuffered(nowMs: number, bufferedAmount: number): void
  /** `true` iff `bufferedAmount` has been continuously above `highWater` for >= `timeoutMs`. */
  stalledPast(nowMs: number, timeoutMs: number): boolean
  /** `true` iff any pane is currently stale or has a held push — i.e. this connection has
   *  outstanding backpressure state a drain/resync still needs to resolve. Drives an "armed only
   *  while pending" transport watch (CONV-036) instead of an always-running poll. */
  hasPending(): boolean
}

export function createBackpressurePolicy(opts?: { highWater?: number; lowWater?: number }): BackpressurePolicy {
  const highWater = opts?.highWater ?? PHONE_WS_HIGH_WATER
  const lowWater = opts?.lowWater ?? PHONE_WS_LOW_WATER
  const stale = new Set<string>()
  const held = new Map<string, HeldPush>()
  let aboveSince: number | undefined

  const heldKey = (kind: string, paneId: string): string => `${kind}:${paneId}`

  return {
    onData(paneId, bufferedAmount) {
      if (stale.has(paneId)) return false
      if (bufferedAmount > highWater) {
        stale.add(paneId)
        return false
      }
      return true
    },
    onDrain(bufferedAmount) {
      if (bufferedAmount >= lowWater) return []
      const resynced = [...stale]
      stale.clear()
      return resynced
    },
    isStale(paneId) {
      return stale.has(paneId)
    },
    onPush(kind, paneId, payload, bufferedAmount) {
      if (bufferedAmount > highWater) {
        held.set(heldKey(kind, paneId), { kind, paneId, payload })
        return false
      }
      return true
    },
    takeHeldPushes() {
      const out = [...held.values()]
      held.clear()
      return out
    },
    clearStale(paneId) {
      stale.delete(paneId)
      for (const [key, entry] of [...held]) if (entry.paneId === paneId) held.delete(key)
    },
    onBuffered(nowMs, bufferedAmount) {
      if (bufferedAmount > highWater) {
        if (aboveSince === undefined) aboveSince = nowMs
      } else {
        aboveSince = undefined
      }
    },
    stalledPast(nowMs, timeoutMs) {
      return aboveSince !== undefined && nowMs - aboveSince >= timeoutMs
    },
    hasPending() {
      return stale.size > 0 || held.size > 0
    }
  }
}
