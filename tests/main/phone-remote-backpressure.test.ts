// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-017: bounded per-client buffering with drop-and-resnapshot. Contract set here for the
// implementer — src/main/phone-remote/constants.ts exports the named limits, and
// src/main/phone-remote/backpressure.ts exports a PURE policy:
//   createBackpressurePolicy(opts?: { highWater?: number; lowWater?: number }): {
//     onData(paneId: string, bufferedAmount: number): boolean  // true = enqueue this chunk
//     onDrain(bufferedAmount: number): string[]                // stale panes to resync NOW
//     isStale(paneId: string): boolean
//   }
// Semantics (each pinned below):
//  - bufferedAmount > highWater  => onData returns false AND marks that pane stale
//  - once stale, onData for that pane stays false regardless of bufferedAmount (a mid-gap chunk
//    enqueued before the resync would reorder the stream) until the pane is resynced
//  - onDrain(amount < lowWater)  => returns each stale pane EXACTLY once and clears staleness;
//    the resync is driven by the drain signal itself, never by a future data chunk (CONV-036 —
//    a gone-quiet stream must not strand a stale pane)
//  - onDrain(amount >= lowWater) => []
import { describe, it, expect } from 'vitest'
import { PHONE_WS_HIGH_WATER, PHONE_WS_LOW_WATER } from '../../src/main/phone-remote/constants'
import { createBackpressurePolicy } from '../../src/main/phone-remote/backpressure'

describe('TEST-2615 REQ-017 exported limits (CONV-003)', () => {
  it('pins the stated water marks', () => {
    expect(PHONE_WS_HIGH_WATER).toBe(1_048_576)
    expect(PHONE_WS_LOW_WATER).toBe(262_144)
    expect(PHONE_WS_LOW_WATER).toBeLessThan(PHONE_WS_HIGH_WATER)
  })
})

describe('TEST-2616 REQ-017 above high water: stop enqueueing, mark stale', () => {
  it('enqueues at/below the mark, drops above it', () => {
    const p = createBackpressurePolicy()
    expect(p.onData('A', 0)).toBe(true)
    expect(p.onData('A', PHONE_WS_HIGH_WATER)).toBe(true)          // "exceeds" is strict
    expect(p.isStale('A')).toBe(false)
    expect(p.onData('A', PHONE_WS_HIGH_WATER + 1)).toBe(false)
    expect(p.isStale('A')).toBe(true)
  })

  it('a stale pane stays suspended even if bufferedAmount dips, until it is resynced', () => {
    const p = createBackpressurePolicy()
    expect(p.onData('A', PHONE_WS_HIGH_WATER + 1)).toBe(false)
    // enqueueing this would deliver a stream with a hole ahead of the resync — must stay false
    expect(p.onData('A', 0)).toBe(false)
    expect(p.isStale('A')).toBe(true)
  })
})

describe('TEST-2617 REQ-017 drain-driven resync, exactly once (CONV-036)', () => {
  it('a drain below low water resyncs each stale pane exactly once — with NO further data chunk', () => {
    const p = createBackpressurePolicy()
    p.onData('A', PHONE_WS_HIGH_WATER + 1)
    // the stream has gone quiet: only the drain signal arrives
    expect(p.onDrain(PHONE_WS_LOW_WATER - 1)).toEqual(['A'])
    expect(p.isStale('A')).toBe(false)
    // exactly once: a second drain has nothing left to resync
    expect(p.onDrain(0)).toEqual([])
  })

  it('a drain at/above low water resyncs nothing yet', () => {
    const p = createBackpressurePolicy()
    p.onData('A', PHONE_WS_HIGH_WATER + 1)
    expect(p.onDrain(PHONE_WS_LOW_WATER)).toEqual([])              // "below" is strict
    expect(p.isStale('A')).toBe(true)
    expect(p.onDrain(PHONE_WS_LOW_WATER - 1)).toEqual(['A'])
  })

  it('after the resync, data for the pane flows again', () => {
    const p = createBackpressurePolicy()
    p.onData('A', PHONE_WS_HIGH_WATER + 1)
    p.onDrain(0)
    expect(p.onData('A', 100)).toBe(true)
  })
})

describe('TEST-2618 REQ-017 multiple panes and repeat cycles', () => {
  it('every pane that had a drop is in the resync set; each exactly once', () => {
    const p = createBackpressurePolicy({ highWater: 100, lowWater: 20 })
    expect(p.onData('A', 101)).toBe(false)
    expect(p.onData('B', 150)).toBe(false)
    expect(p.onData('C', 50)).toBe(true)                            // C never dropped
    const resync = p.onDrain(10)
    expect([...resync].sort()).toEqual(['A', 'B'])
    expect(p.onDrain(0)).toEqual([])
  })

  it('a pane can go stale again after a completed resync cycle', () => {
    const p = createBackpressurePolicy({ highWater: 100, lowWater: 20 })
    p.onData('A', 101)
    expect(p.onDrain(0)).toEqual(['A'])
    expect(p.onData('A', 101)).toBe(false)
    expect(p.onDrain(0)).toEqual(['A'])
  })
})

// ---------------------------------------------------------------------------------------------
// v2 loopback amendments (ESC-001; FINDING-002/019/020) — REQ-017 now covers EVERY message
// class, exposes a stale-clear lifecycle, and bounds a permanently saturated connection.
//
// Contract amendments for the implementer (createBackpressurePolicy gains):
//   onPush(kind: 'status' | 'grid', paneId: string, payload: unknown, bufferedAmount: number): boolean
//     // true = send now. false = the push was HELD (coalesced latest-wins per kind+pane).
//   takeHeldPushes(): Array<{ kind: 'status' | 'grid'; paneId: string; payload: unknown }>
//     // delivered on drain: at most ONE entry per (kind, paneId) carrying the LATEST payload;
//     // the held set is cleared by the take.
//   clearStale(paneId: string): void
//     // unsubscribe / paneExit / fresh-subscribe hook: the pane's stale flag (and any held
//     // pushes for it) cannot outlive its subscription.
//   onBuffered(nowMs: number, bufferedAmount: number): void
//     // continuous-saturation tracking sample (a real transport signal feeds this).
//   stalledPast(nowMs: number, timeoutMs: number): boolean
//     // true iff bufferedAmount has been continuously above the high-water mark for >= timeoutMs.
// And src/main/phone-remote/constants.ts additionally exports the stated keepalive/stall limits.
import * as PHONE_CONSTANTS from '../../src/main/phone-remote/constants'

type PolicyV2 = ReturnType<typeof createBackpressurePolicy> & {
  onPush(kind: string, paneId: string, payload: unknown, bufferedAmount: number): boolean
  takeHeldPushes(): Array<{ kind: string; paneId: string; payload: unknown }>
  clearStale(paneId: string): void
  onBuffered(nowMs: number, bufferedAmount: number): void
  stalledPast(nowMs: number, timeoutMs: number): boolean
}

const mkV2 = (opts?: { highWater?: number; lowWater?: number }): PolicyV2 =>
  createBackpressurePolicy(opts) as PolicyV2

describe('TEST-2701 REQ-017 exported keepalive/stall limits (CONV-003)', () => {
  it('pins the stated values', () => {
    expect(PHONE_CONSTANTS.PHONE_WS_STALL_TIMEOUT_MS).toBe(60_000)
    expect(PHONE_CONSTANTS.PHONE_WS_PING_INTERVAL_MS).toBe(30_000)
    expect(PHONE_CONSTANTS.PHONE_WS_PONG_TIMEOUT_MS).toBe(10_000)
  })
})

describe('TEST-2702 REQ-017 status/grid pushes are coalesced latest-wins while saturated', () => {
  it('sends immediately below the mark; holds above it; the take yields one LATEST entry per kind+pane', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    expect(p.onPush('status', 'A', 'busy', 50), 'an unsaturated push sends now').toBe(true)
    expect(p.takeHeldPushes()).toEqual([])

    expect(p.onPush('status', 'A', 'busy', 101)).toBe(false)
    expect(p.onPush('status', 'A', 'idle', 101)).toBe(false)
    expect(p.onPush('status', 'A', 'needs-input', 101)).toBe(false)
    expect(p.onPush('grid', 'A', { cols: 100, rows: 30 }, 101)).toBe(false)
    expect(p.onPush('grid', 'A', { cols: 120, rows: 40 }, 101)).toBe(false)
    expect(p.onPush('status', 'B', 'busy', 101)).toBe(false)

    const held = p.takeHeldPushes()
    // N flips never accumulate unboundedly: exactly one per (kind, paneId), latest payload
    expect(held).toHaveLength(3)
    expect(held).toContainEqual({ kind: 'status', paneId: 'A', payload: 'needs-input' })
    expect(held).toContainEqual({ kind: 'grid', paneId: 'A', payload: { cols: 120, rows: 40 } })
    expect(held).toContainEqual({ kind: 'status', paneId: 'B', payload: 'busy' })
    expect(p.takeHeldPushes(), 'the take clears the held set').toEqual([])
  })
})

describe('TEST-2703 REQ-017 stale-state lifecycle: clearStale (unsubscribe/paneExit/fresh-subscribe)', () => {
  it('a cleared pane is no longer stale and a later drain resyncs nothing for it', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    p.onData('A', 101)
    expect(p.isStale('A')).toBe(true)
    p.clearStale('A')
    expect(p.isStale('A')).toBe(false)
    expect(p.onDrain(0), 'a drain never resyncs a pane no longer subscribed/live').toEqual([])
  })

  it('clearStale also drops the pane held pushes and is a no-op on a never-stale pane', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    p.onPush('status', 'A', 'busy', 101)
    p.onData('B', 101)
    p.clearStale('A')
    expect(() => p.clearStale('never-seen')).not.toThrow()
    expect(p.takeHeldPushes().filter((h) => h.paneId === 'A')).toEqual([])
    expect(p.onDrain(0)).toEqual(['B'])
  })
})

describe('TEST-2704 REQ-017 continuous-saturation ceiling (the stall deadline)', () => {
  it('reports stalled only after CONTINUOUS above-high-water time reaches the timeout', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    p.onBuffered(0, 101)
    expect(p.stalledPast(59_999, 60_000)).toBe(false)
    p.onBuffered(59_999, 101)
    expect(p.stalledPast(60_000, 60_000)).toBe(true)
  })

  it('a dip below the mark resets the continuity clock', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    p.onBuffered(0, 101)
    p.onBuffered(30_000, 50) // drained below the mark: not a continuous stall
    p.onBuffered(40_000, 101)
    expect(p.stalledPast(99_999, 60_000)).toBe(false)
    expect(p.stalledPast(100_000, 60_000)).toBe(true)
  })

  it('never saturated => never stalled', () => {
    const p = mkV2({ highWater: 100, lowWater: 20 })
    p.onBuffered(0, 10)
    expect(p.stalledPast(1_000_000, 60_000)).toBe(false)
  })
})
