/**
 * The pure drop-and-resnapshot backpressure policy (feature 0026, REQ-017). No I/O, no timers:
 * every trigger is an explicit caller signal (`onData`/`onDrain`), so it is fully unit-testable
 * and the drain-driven resync (CONV-036) can never depend on a chunk that might never arrive.
 */
import { PHONE_WS_HIGH_WATER, PHONE_WS_LOW_WATER } from './constants'

export interface BackpressurePolicy {
  /** `true` = enqueue this chunk. Strictly above `highWater` drops and marks the pane stale;
   *  once stale, EVERY subsequent chunk for that pane is dropped (even if the buffer dips) until
   *  a drain resyncs it — enqueueing a mid-gap chunk would reorder the stream ahead of the resync. */
  onData(paneId: string, bufferedAmount: number): boolean
  /** Strictly below `lowWater`: returns every currently-stale pane exactly once and clears their
   *  staleness. At/above `lowWater`: returns `[]` (nothing resynced yet). */
  onDrain(bufferedAmount: number): string[]
  isStale(paneId: string): boolean
}

export function createBackpressurePolicy(opts?: { highWater?: number; lowWater?: number }): BackpressurePolicy {
  const highWater = opts?.highWater ?? PHONE_WS_HIGH_WATER
  const lowWater = opts?.lowWater ?? PHONE_WS_LOW_WATER
  const stale = new Set<string>()

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
    }
  }
}
