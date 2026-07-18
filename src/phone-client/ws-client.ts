/**
 * The phone client's pure WS message core (feature 0026, REQ-009/REQ-017/REQ-024). No top-level
 * WebSocket/DOM access — this module stays import-safe under node. `main.ts` owns the actual
 * `WebSocket` connection and calls into these pure helpers.
 */

export interface PaneSink {
  write(data: string): void
  reset(): void
}

export interface PaneMessage {
  type: string
  paneId?: string
  data?: string
}

/** `snapshot`/`resync` REPLACE the sink's buffer (reset then write) — never an append. `data`
 *  appends. Every other type is inert (unknown types must never throw). */
export function applyPaneMessage(sink: PaneSink, msg: PaneMessage): void {
  if (msg.type === 'snapshot' || msg.type === 'resync') {
    sink.reset()
    sink.write(msg.data ?? '')
  } else if (msg.type === 'data') {
    sink.write(msg.data ?? '')
  }
}

export interface SubscribeIntent {
  type: 'subscribe'
  paneId: string
}

/** A reconnect performs a FRESH REQ-009 attach per subscribed pane — never assumed stream
 *  continuity across connections (REQ-024). */
export function reconnectAttachPlan(subscribedPaneIds: readonly string[]): SubscribeIntent[] {
  return subscribedPaneIds.map((paneId) => ({ type: 'subscribe' as const, paneId }))
}

// -------------------------------------------------------------------------------------------
// v2 loopback additions (ESC-001; FINDING-021/037/026/036/003/028/016/031) — the client half of
// the hello protocol-drift check, capped-exponential reconnect backoff with a terminal
// auth-revoked state, subscription-hygiene pane-switch planning, and size-before-subscribe pane
// opening (REQ-013).

export interface MessageGate {
  /** `'handle'`: process the message normally. `'reload-required'`: THIS message was the
   *  drift-detecting `hello` — surface a "new version, reload" state. `'drop'`: a drifted client
   *  must stop processing every later message (never silently misparse newer wire traffic). */
  accept(msg: { type?: string; proto?: unknown } & Record<string, unknown>): 'handle' | 'reload-required' | 'drop'
}

/** Compares every `hello`'s `proto` against the bundled `PHONE_REMOTE_PROTO_VERSION` (REQ-010
 *  client half). A mismatch is terminal for the connection's message stream — every later message
 *  (including a later, correct-looking one) is dropped, since a stale cached PWA must never
 *  silently misparse newer wire traffic. */
export function createMessageGate(bundledProto: number): MessageGate {
  let driftDetected = false
  return {
    accept(msg) {
      if (driftDetected) return 'drop'
      if (msg.type === 'hello') {
        if (msg.proto !== bundledProto) { driftDetected = true; return 'reload-required' }
        return 'handle'
      }
      return 'handle'
    }
  }
}

const RECONNECT_BASE_MS = 500
const RECONNECT_CAP_MS = 120_000
/** Consecutive immediate auth-refusals before the client gives up retrying and shows the terminal
 *  "pairing revoked" state (REQ-024) — bounded so a real revoke is detected promptly, but a single
 *  blip never trips it. */
const AUTH_REVOKED_THRESHOLD = 3

/** Capped exponential backoff for reconnect attempts (REQ-024): never retries instantly forever,
 *  never grows unbounded. */
export function reconnectDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt) || 1)
  return Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * Math.pow(2, n - 1))
}

/** Distinguishes a genuinely revoked pairing (repeated immediate auth refusals) from a transient
 *  network blip (REQ-024/FINDING-026/036): once revoked, stays revoked — the caller must prompt a
 *  re-scan, never retry silently forever. */
export function reconnectOutcome(consecutiveAuthRefusals: number): 'retry' | 'revoked' {
  return consecutiveAuthRefusals >= AUTH_REVOKED_THRESHOLD ? 'revoked' : 'retry'
}

export interface PaneSwitchStep {
  type: 'subscribe' | 'unsubscribe'
  paneId: string
}

/** Subscription hygiene (REQ-023 — closes FINDING-003/028): switching panes (or returning to the
 *  list) unsubscribes the DEPARTING pane before subscribing the next, so at most the active pane
 *  ever stays subscribed — a background pane never keeps streaming full pty output the client just
 *  discards. */
export function paneSwitchPlan(from: string | undefined, to: string | undefined): PaneSwitchStep[] {
  const steps: PaneSwitchStep[] = []
  if (from !== undefined && from !== to) steps.push({ type: 'unsubscribe', paneId: from })
  if (to !== undefined && to !== from) steps.push({ type: 'subscribe', paneId: to })
  return steps
}

export type OpenPaneStep =
  | { op: 'size'; cols: number; rows: number }
  | { op: 'subscribe'; paneId: string }

/** Sizes the terminal from the freshest known grid BEFORE subscribing (REQ-013/REQ-023 —
 *  closes FINDING-016/031): a non-80x24 pane must never render mis-wrapped for even one frame. */
export function openPanePlan(pane: { paneId: string; cols: number; rows: number }): [OpenPaneStep, OpenPaneStep] {
  return [
    { op: 'size', cols: pane.cols, rows: pane.rows },
    { op: 'subscribe', paneId: pane.paneId }
  ]
}
