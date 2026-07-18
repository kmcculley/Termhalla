/**
 * The per-pane mirror registry (feature 0026, REQ-001/REQ-008/REQ-015/REQ-026/REQ-013) — the ONE
 * fan-out seam every pane-data source (local PTY and remote-workspace) taps. `registerPane`
 * returns a tap closure that ALWAYS forwards to the existing renderer-forward callback first, in
 * the identical order/sequence, whether or not the server is enabled (REQ-015 purity) — mirror
 * feeding is strictly additive and a throwing mirror must never break that forward (the desktop
 * path is protected). While disabled, no mirror is ever constructed (REQ-001: zero per-chunk
 * mirror work beyond this constant-time enabled check).
 */
import { createPaneReplay, HISTORY_LIMIT_DEFAULT, type PaneReplay, type ReplayFactory } from './replay-engine'

export interface PaneInfo {
  paneId: string
  cols: number
  rows: number
}

export interface MirrorManagerOpts {
  replayFactory?: ReplayFactory
}

export interface MirrorManager {
  /** Installs the tap on the pane-data path. Returns a `(chunk) => void` the caller feeds every
   *  byte through instead of (or in addition to) the raw forward. */
  registerPane(info: PaneInfo, forward: (chunk: string) => void): (chunk: string) => void
  /** `true`: creates a mirror for every already-registered pane at its CURRENT grid. `false`:
   *  disposes every mirror (back to the REQ-001 inert state). */
  setEnabled(enabled: boolean): void
  /** Desktop-driven resize ONLY — the phone never reaches this (REQ-013). */
  resizePane(paneId: string, cols: number, rows: number): void
  paneExited(paneId: string): void
  snapshot(paneId: string): Promise<string> | undefined
  mirrorCount(): number
}

interface Registered {
  info: PaneInfo
  mirror?: PaneReplay
}

export function createMirrorManager(opts?: MirrorManagerOpts): MirrorManager {
  const factory: ReplayFactory = opts?.replayFactory ?? createPaneReplay
  const panes = new Map<string, Registered>()
  let enabled = false

  const createMirror = (rec: Registered): void => {
    rec.mirror = factory({ cols: rec.info.cols, rows: rec.info.rows, scrollback: HISTORY_LIMIT_DEFAULT })
  }

  return {
    registerPane(info, forward) {
      const rec: Registered = { info: { ...info } }
      panes.set(info.paneId, rec)
      if (enabled) createMirror(rec)
      return (chunk: string): void => {
        forward(chunk)
        if (rec.mirror) {
          try { rec.mirror.feed(chunk) } catch { /* the desktop forward path must never break (REQ-015) */ }
        }
      }
    },

    setEnabled(next) {
      if (next === enabled) return
      enabled = next
      if (enabled) {
        for (const rec of panes.values()) if (!rec.mirror) createMirror(rec)
      } else {
        for (const rec of panes.values()) {
          rec.mirror?.dispose()
          rec.mirror = undefined
        }
      }
    },

    resizePane(paneId, cols, rows) {
      const rec = panes.get(paneId)
      if (!rec) return
      rec.info = { ...rec.info, cols, rows }
      rec.mirror?.resize(cols, rows)
    },

    paneExited(paneId) {
      const rec = panes.get(paneId)
      if (!rec) return
      rec.mirror?.dispose()
      panes.delete(paneId)
    },

    snapshot(paneId) {
      return panes.get(paneId)?.mirror?.snapshot()
    },

    mirrorCount() {
      let n = 0
      for (const rec of panes.values()) if (rec.mirror) n++
      return n
    }
  }
}
