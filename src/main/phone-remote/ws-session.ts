/**
 * A single client's multiplexed WS session (feature 0026, REQ-009/010/011/012/013/014/016/017/
 * 018/024/026). `WsSessionDeps` deliberately exposes NO resize/lifecycle capability — the
 * session cannot reach what it cannot see, so REQ-013/REQ-014 hold structurally, not just
 * behaviorally.
 *
 * Attach (REQ-009) is a hold-window state machine per pane: `subscribe` opens an "attaching"
 * window that QUEUES any `paneData` arriving before the mirror's snapshot resolves, so nothing
 * fed between the subscribe call and the snapshot's resolution is lost or duplicated — the
 * snapshot always precedes every `data` message, and pre-snapshot bytes never appear twice.
 * Supersession is IDENTITY-guarded (v2, FINDING-008): a re-subscribe for a pane whose attach is
 * still in flight replaces the pending queue with a NEW array reference; a snapshot resolution
 * only completes the attach if its captured reference is still the CURRENT one for that pane
 * (the repo's session-identity re-check pattern — claim the slot, re-check identity after every
 * await). A superseded resolution completes nothing.
 *
 * The resync path (REQ-017, drain-driven) reuses the SAME hold-window discipline (v2,
 * FINDING-009): on the drain trigger, each stale pane moves into a queued "resyncing" window so
 * data arriving before the resync snapshot resolves is queued BEHIND the resync, never sent ahead
 * of it — a client applying `resync` as a buffer replace can never have a delivered byte erased.
 * `status`/`grid` pushes to a saturated client are coalesced latest-wins per pane (v2,
 * FINDING-002/019) via the backpressure policy's `onPush`/`takeHeldPushes`, flushed on the same
 * drain trigger. A pane's stale/held state is cleared by `unsubscribe`, `paneExit`, and a fresh
 * `subscribe` (v2, FINDING-020) — backpressure state can never outlive its subscription.
 *
 * Every entry point is defensively contained (REQ-018): a throwing `send`, a throwing pane write,
 * or a malformed frame can never propagate an uncaught throw into main (Electron's modal-error-
 * dialog freeze).
 */
import { PHONE_REMOTE_PROTO_VERSION, parseClientMessage } from '@shared/phone-remote/protocol'
import { createBackpressurePolicy } from './backpressure'

export interface WsSessionDeps {
  /** Outbound message object (pre-serialize; the transport layer JSON-stringifies). */
  send(msg: Record<string, unknown>): void
  /** Socket buffer probe for the backpressure policy. Default: always 0 (no drops). */
  bufferedAmount?: () => number
  mirrors: { snapshot(paneId: string): Promise<string> | undefined }
  panes: {
    inventory(): unknown
    isLive(paneId: string): boolean
    write(paneId: string, data: string): void
  }
}

export interface WsSession {
  /** Sends `hello` FIRST (carrying the protocol version), then the pane `panes` inventory. */
  start(): void
  /** One inbound WS frame (untrusted: string, Buffer, or anything else the transport hands back). */
  handleFrame(raw: unknown): void
  /** Live fan-in from the service: pane bytes for a pane this session may or may not be subscribed to. */
  paneData(paneId: string, chunk: string): void
  paneStatus(paneId: string, status: string): void
  paneGrid(paneId: string, cols: number, rows: number): void
  paneExit(paneId: string): void
  /** Re-sends the full `panes` inventory (a membership/metadata change — REQ-011 currency). The
   *  client treats a fresh `panes` message as a list replace. */
  pushInventory(): void
  /** The transport's real drain signal (CONV-036) — the ONLY trigger for a stale-pane resync and
   *  for flushing coalesced status/grid pushes. Cheap to call speculatively (a no-op when nothing
   *  is stale/held). */
  socketDrained(): void
  /** Marks a pane stale in the backpressure policy DIRECTLY (v3 — FINDING-058/060): the service's
   *  pre-transport burst queue calls this when a saturation discard drops real chunks, and it MUST
   *  record staleness even while the pane sits inside an attach/resync hold window — routing a
   *  substitute chunk through `paneData` would be swallowed by the window's pending queue and the
   *  dropped bytes would never be repaired by a resync. A no-op for a pane this session is not
   *  delivering (not live and in no hold window) — staleness can never outlive/precede a
   *  subscription (REQ-017 stale-state lifecycle). */
  markStale(paneId: string): void
  /** `true` iff any pane currently has outstanding backpressure state (stale or a held push) —
   *  the transport layer uses this to arm a "pending" watch only while there is something a
   *  drain could resolve, and to gate `socketDrained()` on proof-of-life (a pong) rather than a
   *  blind poll of the raw transport buffer, which a genuinely paused peer never surfaces. */
  hasPending(): boolean
  close(): void
}

const isThenable = (v: unknown): v is Promise<string> =>
  !!v && typeof (v as { then?: unknown }).then === 'function'

export function createWsSession(deps: WsSessionDeps): WsSession {
  const policy = createBackpressurePolicy()
  // paneId -> the CURRENT queued-chunks array for an in-flight attach (identity-guarded — a
  // resolution whose captured array is no longer this map's value for the pane was superseded).
  const attaching = new Map<string, string[]>()
  // paneId -> the CURRENT queued-chunks array for an in-flight drain-triggered resync.
  const resyncing = new Map<string, string[]>()
  const live = new Set<string>()
  let closed = false

  const bufferedAmount = (): number => (deps.bufferedAmount ? deps.bufferedAmount() : 0)

  const safeSend = (msg: Record<string, unknown>): void => {
    if (closed) return
    try { deps.send(msg) } catch { /* a dead/throwing transport must never reach the pane-data path */ }
  }

  const sendError = (code: string, message: string, extra?: Record<string, unknown>): void => {
    safeSend({ type: 'error', code, message, ...extra })
  }

  const deliverData = (paneId: string, chunk: string): void => {
    if (!policy.onData(paneId, bufferedAmount())) return
    safeSend({ type: 'data', paneId, data: chunk })
  }

  const readSnapshot = (paneId: string, onReady: (snap: string) => void): void => {
    let maybe: Promise<string> | string | undefined
    try {
      maybe = deps.mirrors.snapshot(paneId)
    } catch {
      maybe = undefined
    }
    if (isThenable(maybe)) {
      maybe.then((snap) => onReady(snap ?? ''), () => onReady(''))
    } else {
      onReady((maybe as string | undefined) ?? '')
    }
  }

  const sendInventory = (): void => {
    let inventory: unknown
    try { inventory = deps.panes.inventory() } catch { inventory = undefined }
    const payload = inventory && typeof inventory === 'object' && !Array.isArray(inventory)
      ? (inventory as Record<string, unknown>)
      : {}
    safeSend({ type: 'panes', ...payload })
  }

  const finishAttach = (paneId: string, pending: string[], snap: string): void => {
    // Identity guard (v2, FINDING-008): a later subscribe replaced `attaching.get(paneId)` with a
    // NEW array — this resolution is stale/superseded and must complete nothing.
    if (attaching.get(paneId) !== pending) return
    attaching.delete(paneId)
    live.add(paneId)
    safeSend({ type: 'snapshot', paneId, data: snap })
    for (const chunk of pending) deliverData(paneId, chunk)
  }

  const doSubscribe = (paneId: string): void => {
    if (!deps.panes.isLive(paneId)) {
      sendError('no-such-pane', `no such pane: ${paneId}`, { paneId })
      return
    }
    // A fresh attach resets this pane's backpressure state — the snapshot IS the resync
    // (v2, FINDING-020): staleness/held-pushes/an in-flight resync window can't outlive it.
    policy.clearStale(paneId)
    resyncing.delete(paneId)
    live.delete(paneId)
    const pending: string[] = []
    attaching.set(paneId, pending)
    readSnapshot(paneId, (snap) => finishAttach(paneId, pending, snap))
  }

  const doUnsubscribe = (paneId: string): void => {
    attaching.delete(paneId)
    resyncing.delete(paneId)
    live.delete(paneId)
    policy.clearStale(paneId)
  }

  const doInput = (paneId: string, data: string): void => {
    if (!deps.panes.isLive(paneId)) {
      sendError('no-such-pane', `no such pane: ${paneId}`, { paneId })
      return
    }
    try {
      deps.panes.write(paneId, data)
    } catch {
      sendError('write-failed', `failed to write to pane: ${paneId}`, { paneId })
    }
  }

  const finishResync = (paneId: string, pending: string[], snap: string): void => {
    if (resyncing.get(paneId) !== pending) return // superseded (unsubscribe/paneExit/fresh subscribe)
    resyncing.delete(paneId)
    safeSend({ type: 'resync', paneId, data: snap })
    for (const chunk of pending) deliverData(paneId, chunk)
  }

  return {
    start() {
      safeSend({ type: 'hello', proto: PHONE_REMOTE_PROTO_VERSION })
      sendInventory()
    },

    handleFrame(raw) {
      try {
        const parsed = parseClientMessage(raw)
        if (!parsed.ok) {
          sendError(parsed.error.code, parsed.error.message)
          return
        }
        const { msg } = parsed
        if (msg.type === 'subscribe') doSubscribe(msg.paneId)
        else if (msg.type === 'unsubscribe') doUnsubscribe(msg.paneId)
        else if (msg.type === 'input') doInput(msg.paneId, msg.data ?? '')
      } catch {
        sendError('internal-error', 'failed to process the message')
      }
    },

    paneData(paneId, chunk) {
      const attachPending = attaching.get(paneId)
      if (attachPending) { attachPending.push(chunk); return }
      const resyncPending = resyncing.get(paneId)
      if (resyncPending) { resyncPending.push(chunk); return }
      if (!live.has(paneId)) return
      deliverData(paneId, chunk)
    },

    paneStatus(paneId, status) {
      // Status pushes are not gated on subscription — the client holds a live inventory of every
      // pane's status regardless of which terminals it has open (REQ-011). While saturated they
      // coalesce latest-wins per pane (v2, FINDING-002/019) instead of accumulating unboundedly.
      if (!policy.onPush('status', paneId, status, bufferedAmount())) return
      safeSend({ type: 'status', paneId, status })
    },

    paneGrid(paneId, cols, rows) {
      if (!live.has(paneId) && !attaching.has(paneId)) return
      if (!policy.onPush('grid', paneId, { cols, rows }, bufferedAmount())) return
      safeSend({ type: 'grid', paneId, cols, rows })
    },

    paneExit(paneId) {
      attaching.delete(paneId)
      resyncing.delete(paneId)
      live.delete(paneId)
      policy.clearStale(paneId)
      safeSend({ type: 'paneExit', paneId })
      safeSend({ type: 'status', paneId, status: 'exited' })
    },

    pushInventory() {
      sendInventory()
    },

    hasPending() {
      return policy.hasPending()
    },

    markStale(paneId) {
      if (!live.has(paneId) && !attaching.has(paneId) && !resyncing.has(paneId)) return
      policy.markStale(paneId)
    },

    socketDrained() {
      const buffered = bufferedAmount()
      const staleIds = policy.onDrain(buffered)
      for (const paneId of staleIds) {
        // A stale pane whose ATTACH is still in flight must NOT get a concurrent resync window
        // (v3, FINDING-058/060 — reachable since markStale can act mid-attach): paneData routes
        // to the attach queue FIRST, so a chunk fed after the resync barrier would be delivered
        // right after the attach completes and then ERASED by the resync's buffer replace. Keep
        // the pane stale instead — the attach completes with the policy dropping its pending
        // chunks, and the NEXT drain resyncs it with a barrier that covers everything.
        if (attaching.has(paneId)) { policy.markStale(paneId); continue }
        // Hold-window for the resync itself (v2, FINDING-009): data arriving between NOW and the
        // snapshot's resolution is queued behind the resync, never sent ahead of it.
        const pending: string[] = []
        resyncing.set(paneId, pending)
        readSnapshot(paneId, (snap) => finishResync(paneId, pending, snap))
      }
      for (const push of policy.takeHeldPushes()) {
        if (push.kind === 'status') {
          safeSend({ type: 'status', paneId: push.paneId, status: push.payload })
        } else if (push.kind === 'grid') {
          const g = push.payload as { cols: number; rows: number }
          safeSend({ type: 'grid', paneId: push.paneId, cols: g.cols, rows: g.rows })
        }
      }
    },

    close() {
      closed = true
      attaching.clear()
      resyncing.clear()
      live.clear()
    }
  }
}
