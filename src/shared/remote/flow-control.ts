/**
 * Windowed flow control (F17: REQ-001..REQ-009, REQ-012) — the semantics for F15's reserved
 * `ack`/`window` frame shapes, in ONE pure module BOTH endpoints import so the two sides can
 * never disagree on the measure or the defaults.
 *
 * The measure (D1): UTF-16 code units of the `pty:data` payload string — `data.length`. O(1),
 * environment-pure (TEST-745 forbids every Node byte primitive here), and symmetric by
 * construction because both state machines below take the RAW payload string, never a
 * caller-computed size. The wire field name `bytes` is F15's frozen shape; proportionality,
 * not byte-exactness, is what bounds memory.
 *
 * The agent side (`createAgentFlowGate`) tracks per-pane unacknowledged units and returns
 * pause/resume DECISIONS with watermark hysteresis (D2): pause when `unacked > window`,
 * resume when `unacked <= floor(window / 2)` ("drained"). Resume-at-zero would deadlock a
 * quantized acker; resume-at-window would thrash at the boundary. The client side
 * (`createClientAckPolicy`) acknowledges the full accumulation every `ackEveryBytes` units;
 * flushing sub-quantum residue is the CONSUMER's call (no timers, no wall-clock promises —
 * CONV-036's composition-root rule).
 *
 * Pure module: zero Node/Electron imports, no timers, no clock, no RNG (TEST-745, TEST-781).
 */
import type { AckFrame } from './messages'

/** Default per-pane window: 1 MiB of unacked output before the pty is paused (D3). */
export const DEFAULT_FLOW_WINDOW_BYTES = 1_048_576
/** Default client ack cadence: acknowledge every 64 KiB received (D3; 16:1 vs the window). */
export const DEFAULT_ACK_EVERY_BYTES = 65_536

/** The single shared measure (D1): UTF-16 code units of the payload string. */
export const flowPayloadSize = (data: string): number => data.length

/** A flow transition the agent must apply to a pane's backend handle. */
export interface FlowDecision {
  id: string
  action: 'pause' | 'resume'
}

export interface AgentFlowGateInit {
  /** Window applied to panes without an explicit per-pane `window` frame. Positive integer. */
  defaultWindowBytes?: number
  /** Receives over-ack and unknown-pane-window diagnostics; the agent wires this to stderr. */
  onDiagnostic?: (text: string) => void
}

export interface AgentFlowGate {
  /** Count an emitted `pty:data` payload; may return a pause decision (REQ-004, REQ-005). */
  onDataEmitted(id: string, data: string): FlowDecision[]
  /** Apply an inbound ack (REQ-006); may return a resume decision (REQ-008). */
  onAck(id: string, bytes: number): FlowDecision[]
  /** Apply an inbound window frame — per-pane with `id`, connection default without (REQ-007). */
  onWindow(size: number, id?: string): FlowDecision[]
  /** Prune ALL flow state for a departed pane (REQ-009, CONV-011). */
  paneExited(id: string): void
  /** Clear every pane (session end). */
  dispose(): void
  /** Observability for tests and diagnostics; `undefined` for an untracked pane. */
  stats(id: string): { unacked: number; windowBytes: number; paused: boolean } | undefined
}

export interface ClientAckPolicyInit {
  /** Acknowledge whenever a pane's unacked accumulation reaches this. Positive integer. */
  ackEveryBytes?: number
}

export interface ClientAckPolicy {
  /** Count a received `pty:data` payload; returns the ack frame to send when due, else null. */
  onData(id: string, data: string): AckFrame | null
  /** Residue acks (one per pane with a pending accumulation, sorted by pane id), then reset. */
  flush(): AckFrame[]
  /** Prune a closed pane's accumulation (REQ-009, CONV-011). */
  paneClosed(id: string): void
  /** Clear every pane. */
  dispose(): void
}

const requirePositiveInteger = (name: string, value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer (payload units), got ${String(value)} - omit it to use the default`
    )
  }
  return value
}

interface PaneFlow {
  unacked: number
  paused: boolean
  /** A per-pane `window` frame overrides the connection default until the pane exits. */
  explicitWindow: number | null
}

export const createAgentFlowGate = (init: AgentFlowGateInit = {}): AgentFlowGate => {
  let defaultWindow = requirePositiveInteger('defaultWindowBytes', init.defaultWindowBytes, DEFAULT_FLOW_WINDOW_BYTES)
  const diag = init.onDiagnostic ?? ((): void => undefined)
  const panes = new Map<string, PaneFlow>()

  const windowOf = (p: PaneFlow): number => p.explicitWindow ?? defaultWindow

  /** Transitions are edge-triggered off the `paused` flag, so decisions per pane strictly
   *  alternate pause -> resume -> pause ... (REQ-008); a single event never needs both. */
  const evaluate = (id: string, p: PaneFlow): FlowDecision[] => {
    const window = windowOf(p)
    if (!p.paused && p.unacked > window) {
      p.paused = true
      return [{ id, action: 'pause' }]
    }
    if (p.paused && p.unacked <= Math.floor(window / 2)) {
      p.paused = false
      return [{ id, action: 'resume' }]
    }
    return []
  }

  return {
    onDataEmitted(id: string, data: string): FlowDecision[] {
      let p = panes.get(id)
      if (!p) {
        p = { unacked: 0, paused: false, explicitWindow: null }
        panes.set(id, p)
      }
      p.unacked += flowPayloadSize(data)
      return evaluate(id, p)
    },

    onAck(id: string, bytes: number): FlowDecision[] {
      const p = panes.get(id)
      if (!p) return [] // ack racing a pane's exit is a NORMAL interleaving: silent (D4, REQ-006)
      if (bytes > p.unacked) {
        diag(`flow: pane "${id}" acked ${bytes} units with only ${p.unacked} outstanding - ` +
          'clamping to 0 (client accounting drift or a client bug; the measure is data.length on both sides)')
        p.unacked = 0
      } else {
        p.unacked -= bytes
      }
      return evaluate(id, p)
    },

    onWindow(size: number, id?: string): FlowDecision[] {
      if (id !== undefined) {
        const p = panes.get(id)
        if (!p) {
          // Never stored: windows for not-yet-live panes would grow agent memory without
          // bound - the exact failure mode this feature exists to prevent (D4, REQ-007).
          diag(`flow: window frame (size ${size}) for unknown pane "${id}" ignored - ` +
            'per-pane windows apply to live panes only')
          return []
        }
        p.explicitWindow = size
        return evaluate(id, p)
      }
      defaultWindow = size
      const decisions: FlowDecision[] = []
      for (const [paneId, p] of panes) {
        if (p.explicitWindow === null) decisions.push(...evaluate(paneId, p))
      }
      return decisions
    },

    paneExited(id: string): void {
      panes.delete(id)
    },

    dispose(): void {
      panes.clear()
    },

    stats(id: string): { unacked: number; windowBytes: number; paused: boolean } | undefined {
      const p = panes.get(id)
      return p ? { unacked: p.unacked, windowBytes: windowOf(p), paused: p.paused } : undefined
    }
  }
}

export const createClientAckPolicy = (init: ClientAckPolicyInit = {}): ClientAckPolicy => {
  const ackEvery = requirePositiveInteger('ackEveryBytes', init.ackEveryBytes, DEFAULT_ACK_EVERY_BYTES)
  /** Accumulations are always > 0: zero-size data never creates state (REQ-012), and a
   *  threshold-crossing ack deletes the entry, so `flush` never emits a zero-byte frame. */
  const pending = new Map<string, number>()

  return {
    onData(id: string, data: string): AckFrame | null {
      const size = flowPayloadSize(data)
      if (size === 0) return null
      const total = (pending.get(id) ?? 0) + size
      if (total >= ackEvery) {
        pending.delete(id)
        return { type: 'ack', id, bytes: total } // the ENTIRE accumulation, resetting to zero
      }
      pending.set(id, total)
      return null
    },

    flush(): AckFrame[] {
      const out: AckFrame[] = []
      for (const id of [...pending.keys()].sort()) {
        out.push({ type: 'ack', id, bytes: pending.get(id) as number })
      }
      pending.clear()
      return out
    },

    paneClosed(id: string): void {
      pending.delete(id)
    },

    dispose(): void {
      pending.clear()
    }
  }
}
