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
