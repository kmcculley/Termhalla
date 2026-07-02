import { useStore } from '../store'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { OrkyPane } from './OrkyPane'
import { getTileSize } from './pane-geometry'

/**
 * Kept-mounted, off-layout host for a MINIMIZED pane's body. Minimize prunes the pane's leaf from the
 * *visible* mosaic so siblings reflow to fill the freed space (C2), but the pane's React subtree —
 * xterm + scrollback, Monaco models + unsaved drafts, the live PTY — must keep ticking. So we render
 * the same pane body here, off the layout tree:
 *  - `visibility: hidden` (NEVER `display: none`, which zeros size → FitAddon/PTY-grid thrash and
 *    disposes xterm scrollback / Monaco models — the keep-mounted invariant C1).
 *  - sized to the pane's PRE-MINIMIZE tile size (from `pane-geometry`) rather than always the full
 *    body: a 50%-width tile re-mounted here keeps the SAME xterm grid (cols/rows), so re-adoption
 *    triggers no PTY resize — and thus no ConPTY repaint that would evict the prompt from the status
 *    tail and wedge live needs-input detection (the status-tail gotcha / FINDING-DA-002). A single
 *    full-body pane is the degenerate case (its tile == the body). Falls back to `inset: 0` when no
 *    size was captured (e.g. a pane minimized before any tile measured it).
 *  - `pointer-events: none` + behind the mosaic so it never intercepts clicks or shows through.
 *
 * The minimize/restore transition is the same-window move: the store arms the main-side buffered
 * transit + stashes the terminal snapshot / flushes the editor draft / stashes the explorer view-
 * state before the source unmounts, and this mount re-adopts the running PTY via the idempotent
 * `pty:spawn` and replays the snapshot + the buffered gap bytes. No PTY teardown.
 */
export function MinimizedPaneHost({ wsId, paneId }: { wsId: string; paneId: string }) {
  const pane = useStore(s => s.workspaces[wsId]?.panes[paneId])
  if (!pane) return null
  const size = getTileSize(paneId)
  const box = size
    ? { left: 0, top: 0, width: size.width, height: size.height }
    : { inset: 0 }
  return (
    <div data-testid={`min-host-${paneId}`} aria-hidden
      style={{
        position: 'absolute', ...box,
        visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden', zIndex: -1
      }}>
      {pane.config.kind === 'terminal' && <TerminalPane paneId={paneId} wsId={wsId} config={pane.config} />}
      {pane.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={wsId} config={pane.config} />}
      {pane.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={wsId} config={pane.config} />}
      {/* The orky pane mounts here HIDDEN (feature 0009, REQ-010 T3): its notification fetches are
          suppressed into a stale mark until restore — the concrete displayed/hidden boundary. */}
      {pane.config.kind === 'orky' && <OrkyPane paneId={paneId} wsId={wsId} config={pane.config} hidden />}
    </div>
  )
}
