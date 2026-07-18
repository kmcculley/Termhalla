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
  /** The transport's drain event (CONV-036) — the ONLY trigger for a stale-pane resync. */
  socketDrained(): void
  close(): void
}

const isThenable = (v: unknown): v is Promise<string> =>
  !!v && typeof (v as { then?: unknown }).then === 'function'

export function createWsSession(deps: WsSessionDeps): WsSession {
  const policy = createBackpressurePolicy()
  // paneId -> queued chunks arriving during the attach hold-window (present iff attaching).
  const attaching = new Map<string, string[]>()
  const live = new Set<string>()
  let closed = false

  const safeSend = (msg: Record<string, unknown>): void => {
    if (closed) return
    try { deps.send(msg) } catch { /* a dead/throwing transport must never reach the pane-data path */ }
  }

  const sendError = (code: string, message: string, extra?: Record<string, unknown>): void => {
    safeSend({ type: 'error', code, message, ...extra })
  }

  const deliverData = (paneId: string, chunk: string): void => {
    const buffered = deps.bufferedAmount ? deps.bufferedAmount() : 0
    if (!policy.onData(paneId, buffered)) return
    safeSend({ type: 'data', paneId, data: chunk })
  }

  const finishAttach = (paneId: string, snap: string): void => {
    const pending = attaching.get(paneId)
    if (!pending) return // superseded by an unsubscribe (or a second subscribe) meanwhile
    attaching.delete(paneId)
    live.add(paneId)
    safeSend({ type: 'snapshot', paneId, data: snap })
    for (const chunk of pending) deliverData(paneId, chunk)
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

  const doSubscribe = (paneId: string): void => {
    if (!deps.panes.isLive(paneId)) {
      sendError('no-such-pane', `no such pane: ${paneId}`, { paneId })
      return
    }
    live.delete(paneId)
    attaching.set(paneId, [])
    readSnapshot(paneId, (snap) => finishAttach(paneId, snap))
  }

  const doUnsubscribe = (paneId: string): void => {
    attaching.delete(paneId)
    live.delete(paneId)
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

  return {
    start() {
      safeSend({ type: 'hello', proto: PHONE_REMOTE_PROTO_VERSION })
      let inventory: unknown
      try { inventory = deps.panes.inventory() } catch { inventory = undefined }
      const payload = inventory && typeof inventory === 'object' && !Array.isArray(inventory)
        ? (inventory as Record<string, unknown>)
        : {}
      safeSend({ type: 'panes', ...payload })
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
      const pending = attaching.get(paneId)
      if (pending) { pending.push(chunk); return }
      if (!live.has(paneId)) return
      deliverData(paneId, chunk)
    },

    paneStatus(paneId, status) {
      // Status pushes are not gated on subscription — the client holds a live inventory of every
      // pane's status regardless of which terminals it has open (REQ-011).
      safeSend({ type: 'status', paneId, status })
    },

    paneGrid(paneId, cols, rows) {
      if (!live.has(paneId) && !attaching.has(paneId)) return
      safeSend({ type: 'grid', paneId, cols, rows })
    },

    paneExit(paneId) {
      attaching.delete(paneId)
      live.delete(paneId)
      safeSend({ type: 'paneExit', paneId })
      safeSend({ type: 'status', paneId, status: 'exited' })
    },

    socketDrained() {
      const buffered = deps.bufferedAmount ? deps.bufferedAmount() : 0
      const staleIds = policy.onDrain(buffered)
      for (const paneId of staleIds) {
        readSnapshot(paneId, (snap) => safeSend({ type: 'resync', paneId, data: snap }))
      }
    },

    close() {
      closed = true
      attaching.clear()
      live.clear()
    }
  }
}
