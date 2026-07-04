/**
 * Request/response correlation (REQ-012).
 *
 * A pure state machine — no timers, no clocks, no randomness, no callbacks — that the
 * F16 transport wraps: it allocates monotonic request ids (from 1, +1 per request,
 * never reused within a tracker), matches responses to exactly their own pending
 * request, detects duplicates and unknown ids, and drains every pending request
 * EXACTLY ONCE (in id order) when the connection closes.
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */
import { ProtocolError, protocolFailure } from './errors'
import { type ReqFrame, type ResFrame } from './messages'

export interface OpenedRequest {
  id: number
  /** The ready-to-send req frame. */
  frame: ReqFrame
}

export type SettleResult =
  | { kind: 'settled'; id: number; method: string; response: ResFrame }
  | { kind: 'unknown-id'; id: number }
  | { kind: 'duplicate'; id: number }
  | { kind: 'closed'; id: number }

export interface FailedRequest {
  id: number
  method: string
  reason: string
}

export interface RequestTracker {
  /** Allocate the next id and build the req frame. Throws `tracker-closed` after close. */
  open(method: string, params: unknown): OpenedRequest
  /** Route a response to its pending request; reports duplicates/unknown ids/late-after-close. */
  settle(response: ResFrame): SettleResult
  /** Close the tracker, draining every still-pending request exactly once, in id order. */
  failAllPending(reason: string): FailedRequest[]
  readonly pendingCount: number
}

export const createRequestTracker = (): RequestTracker => {
  let nextId = 1
  let closed = false
  const pending = new Map<number, string>() // id -> method
  const settled = new Set<number>()

  return {
    open(method: string, params: unknown): OpenedRequest {
      if (closed) {
        throw new ProtocolError(protocolFailure(
          'tracker-closed',
          `cannot open request "${method}": this tracker was closed (the connection ended) — create a new tracker for a new connection`,
          { method }
        ))
      }
      const id = nextId
      nextId += 1
      pending.set(id, method)
      return { id, frame: { type: 'req', id, method, params } }
    },

    settle(response: ResFrame): SettleResult {
      const id = response.id
      if (closed) return { kind: 'closed', id }
      const method = pending.get(id)
      if (method !== undefined) {
        pending.delete(id)
        settled.add(id)
        return { kind: 'settled', id, method, response }
      }
      if (settled.has(id)) return { kind: 'duplicate', id }
      return { kind: 'unknown-id', id }
    },

    failAllPending(reason: string): FailedRequest[] {
      if (closed) return []
      closed = true
      const drained = [...pending.entries()]
        .sort((a, b) => a[0] - b[0]) // deterministic id order, independent of insertion history
        .map(([id, method]) => ({ id, method, reason }))
      pending.clear()
      return drained
    },

    get pendingCount(): number {
      return pending.size
    }
  }
}
