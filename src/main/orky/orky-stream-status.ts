import type { OrkyPaneStatus } from '@shared/types'
import { orkyHeartbeatToPaneStatus, selectOrkyPaneStatus } from '@shared/orky-status'
import type { OrkyHeartbeat } from '../status/orky-osc-parser'

interface PaneSlot { fs: OrkyPaneStatus | null; stream: OrkyPaneStatus | null }

/** Per-pane combiner for feature 0014 (TASK-007): composes the filesystem-derived (0004
 *  `OrkyTracker`) and stream-derived (0014 `OrkyOscParser`) sources of `OrkyPaneStatus`, applying
 *  the pure `selectOrkyPaneStatus` filesystem-wins precedence (REQ-009), and emits the combined
 *  result over the SAME `orky:status` channel/payload shape `register-orky.ts` already sends — no
 *  new channel, no new type (REQ-008). This is the ONLY place fs+stream are combined; it never
 *  imports or modifies `orky-tracker.ts` itself (REQ-009) — it only consumes the existing `emit`
 *  callback's output as an input via `setFsStatus`. Strictly in-memory: no fs/chokidar/IPC of its
 *  own, no persistence (REQ-013). */
export class OrkyStreamStatusBridge {
  private panes = new Map<string, PaneSlot>()
  private lastKey = new Map<string, string>()

  constructor(private readonly emit: (id: string, status: OrkyPaneStatus | null) => void) {}

  /** Route 0004's `OrkyTracker` emit callback output through the bridge instead of sending
   *  directly, so it can be combined with any stream-derived status for the same pane. */
  setFsStatus(id: string, status: OrkyPaneStatus | null): void {
    this.recompute(id, slot => { slot.fs = status })
  }

  /** Route `StatusEngine`'s `onOrkyHeartbeat` callback. `hb === null` clears the stream slot (used
   *  on pane teardown so a closed pane's stale stream-derived status cannot linger). */
  setStreamHeartbeat(id: string, hb: OrkyHeartbeat | null): void {
    this.recompute(id, slot => { slot.stream = hb ? orkyHeartbeatToPaneStatus(hb) : null })
  }

  /** Drop all state for a pane (e.g. on PTY close) — no further emits will be considered for it. */
  clearPane(id: string): void {
    this.panes.delete(id)
    this.lastKey.delete(id)
  }

  private recompute(id: string, mutate: (slot: PaneSlot) => void): void {
    let slot = this.panes.get(id)
    if (!slot) { slot = { fs: null, stream: null }; this.panes.set(id, slot) }
    mutate(slot)
    const combined = selectOrkyPaneStatus(slot.fs, slot.stream)
    const key = combined ? JSON.stringify(combined) : ''
    if (this.lastKey.get(id) === key) return // dedup, mirrors StatusEngine.emit's key !== s.last pattern
    this.lastKey.set(id, key)
    this.emit(id, combined)
  }
}
