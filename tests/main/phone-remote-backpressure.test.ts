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
