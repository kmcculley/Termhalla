// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// Request/response correlation: monotonic ids, out-of-order settlement,
// duplicate/unknown detection, exactly-once drain on close.
// Covers REQ-012 and parts of REQ-015 (tracker-closed is actionable).
import { describe, it, expect } from 'vitest'
import {
  createRequestTracker,
  parseWireMessage,
  ProtocolError,
  type ResFrame
} from '@shared/remote/protocol'

// Loopback 1 (tests re-entry): return type narrowed WireFrame -> ResFrame so the helper
// composes with RequestTracker.settle(ResFrame) under `npm run typecheck` (TS2345).
const res = (id: number, ok = true): ResFrame =>
  ok
    ? { type: 'res', id, ok: true, result: { echoed: id } }
    : { type: 'res', id, ok: false, error: { message: `request ${id} failed: boom` } }

const caught = (fn: () => unknown): ProtocolError => {
  try { fn() } catch (e) { return e as ProtocolError }
  throw new Error('expected the call to throw, but it returned')
}

describe('TEST-743 REQ-012 allocation, matching, duplicates, unknown ids', () => {
  it('allocates ids from 1, incrementing by 1, and emits ready-to-send req frames', () => {
    const t = createRequestTracker()
    const a = t.open('m-a', { x: 1 })
    const b = t.open('m-b', null)
    const c = t.open('m-c', 'payload')
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3])
    expect(a.frame).toEqual({ type: 'req', id: 1, method: 'm-a', params: { x: 1 } })
    expect(b.frame).toEqual({ type: 'req', id: 2, method: 'm-b', params: null })
    expect(c.frame).toEqual({ type: 'req', id: 3, method: 'm-c', params: 'payload' })
    for (const f of [a.frame, b.frame, c.frame]) expect(parseWireMessage(f).ok).toBe(true)
    expect(t.pendingCount).toBe(3)
  })

  it('settles out of order, each response reaching exactly its own request', () => {
    const t = createRequestTracker()
    t.open('m-1', null)
    t.open('m-2', null)
    t.open('m-3', null)

    const s2 = t.settle(res(2))
    expect(s2).toEqual({ kind: 'settled', id: 2, method: 'm-2', response: res(2) })
    const s1 = t.settle(res(1, false))
    expect(s1).toEqual({ kind: 'settled', id: 1, method: 'm-1', response: res(1, false) })
    expect(t.pendingCount).toBe(1)

    expect(t.settle(res(2))).toEqual({ kind: 'duplicate', id: 2 })
    expect(t.settle(res(99))).toEqual({ kind: 'unknown-id', id: 99 })
    expect(t.pendingCount).toBe(1)
  })

  it('never reuses an id within a tracker, even after settlement', () => {
    const t = createRequestTracker()
    const first = t.open('m', null)
    t.settle(res(first.id))
    const second = t.open('m', null)
    expect(second.id).toBe(first.id + 1)
  })
})

describe('TEST-744 REQ-012 drain-on-close: exactly once, then closed semantics', () => {
  it('failAllPending returns each pending request exactly once, in id order, and closes the tracker', () => {
    const t = createRequestTracker()
    t.open('m-1', null)
    t.open('m-2', null)
    t.open('m-3', null)
    t.settle(res(1))

    const drained = t.failAllPending('connection closed')
    expect(drained).toEqual([
      { id: 2, method: 'm-2', reason: 'connection closed' },
      { id: 3, method: 'm-3', reason: 'connection closed' }
    ])
    expect(t.pendingCount).toBe(0)

    // second drain yields nothing — the entries were delivered exactly once
    expect(t.failAllPending('connection closed')).toEqual([])

    // a late response after close is identifiable as such
    expect(t.settle(res(2))).toEqual({ kind: 'closed', id: 2 })
    expect(t.settle(res(3))).toEqual({ kind: 'closed', id: 3 })
  })

  it('open after close throws a structured, actionable tracker-closed error (CONV-001)', () => {
    const t = createRequestTracker()
    t.open('m-1', null)
    t.failAllPending('shutdown')
    const err = caught(() => t.open('m-2', null))
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err.reason).toBe('tracker-closed')
    expect(err.message.length).toBeGreaterThan(12)
  })
})
