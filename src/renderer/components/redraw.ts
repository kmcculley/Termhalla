/** The aggressive "Redraw terminal" action, pure of xterm/Electron so it is unit-testable: every
 *  side effect is injected. A plain `term.refresh()` only repaints xterm's *existing* buffer, so it
 *  can't fix corruption that lives in the running program's frame (a half-cleared TUI overlay, a
 *  merged Claude/tmux repaint). To clear that we must make the program re-emit a clean frame, so we
 *  do two things the auto per-resize path deliberately never does:
 *
 *   1. A real SIGWINCH nudge — resize the PTY to a distinctly smaller grid *now*, then back to the
 *      fitted size on a later tick. The two sizes land in separate event-loop turns so ConPTY / the
 *      program can't coalesce them into a no-op (the old same-tick ±1 col pair could be).
 *   2. Send Ctrl+L (form feed) — the near-universal "redraw / clear" key. Shells (PSReadLine, bash)
 *      and full-screen TUIs (Claude, vim, less, tmux) all repaint a clean frame on it.
 *
 *  This is reserved for the explicit command; it injects input and may clear the screen, which the
 *  auto path must never do. Safe re: the status tail — that is ANSI-stripped (see status-tracker). */

export interface RedrawDeps {
  /** Re-fit xterm to its host element (FitAddon). */
  fit: () => void
  /** Repaint xterm from its own buffer (`term.refresh`). */
  repaint: () => void
  /** Current fitted grid, read *after* fit(). */
  dims: () => { cols: number; rows: number }
  /** Resize the PTY (`api.ptyResize`). */
  resize: (size: { cols: number; rows: number }) => void
  /** Write raw bytes to the PTY (`api.ptyWrite`). */
  write: (data: string) => void
  /** Defer the restore to a later event-loop turn (default `setTimeout(fn, 0)`). */
  schedule: (fn: () => void) => void
}

/** Ctrl+L — ASCII form feed; the conventional terminal redraw/clear keystroke. */
export const FORM_FEED = '\x0c'

/** How far to shrink the grid for the nudge. Bigger than 1 so the change is unmistakable, but the
 *  result is clamped to a 1x1 floor so a tiny pane never resizes to a non-positive grid. */
const SHRINK = 2

export function redraw(d: RedrawDeps): void {
  d.fit()
  d.repaint()
  const { cols, rows } = d.dims()
  // Shrink now…
  d.resize({ cols: Math.max(cols - SHRINK, 1), rows: Math.max(rows - SHRINK, 1) })
  // …restore + redraw on the next turn, so the program sees two distinct sizes.
  d.schedule(() => {
    d.resize({ cols, rows })   // re-sync the PTY to the fitted grid
    d.repaint()
    d.write(FORM_FEED)         // Ctrl+L → program clears & redraws a clean frame
  })
}
