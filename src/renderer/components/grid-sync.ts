/** Fit xterm to its host element, then tell the PTY — the one place the two are kept in agreement.
 *
 *  `FitAddon.fit()` calls `term.resize()` internally, and nothing listens to `term.onResize`. So a
 *  `fit()` that is not paired with a `ptyResize` silently leaves the PTY on the old grid: the program
 *  keeps drawing at the old width into a terminal of a new width, which renders garbled. Ctrl+L does
 *  not fix that (the program simply redraws at the same wrong width) — only a real resize does, which
 *  is why maximizing a pane appears to cure it. Both call sites (the ResizeObserver and the
 *  font/theme effect, which re-grids xterm because the cell size changed) must go through here.
 *
 *  The `last`/`setLast` pair is the deliberate no-redundant-resize guard: a redundant resize forces a
 *  ConPTY repaint, which can evict the status tail and break needs-input detection (CLAUDE.md).
 *
 *  Side effects are injected so this stays unit-testable under vitest's node env — the module must
 *  never import `../api` (it reads `window.termhalla` at load). */
export interface GridSyncDeps {
  /** Re-fit xterm to its host element (FitAddon). */
  fit: () => void
  /** The fitted grid, read *after* fit(). */
  dims: () => { cols: number; rows: number }
  /** The grid the PTY was last told about. */
  last: () => { cols: number; rows: number }
  /** Record the grid the PTY has now been told about. */
  setLast: (grid: { cols: number; rows: number }) => void
  /** Resize the PTY (`api.ptyResize`). */
  resize: (grid: { cols: number; rows: number }) => void
}

/** Returns true when the grid changed and the PTY was resized. */
export function syncGrid(d: GridSyncDeps): boolean {
  d.fit()
  const next = d.dims()
  const prev = d.last()
  if (next.cols === prev.cols && next.rows === prev.rows) return false
  d.setLast(next)
  d.resize(next)
  return true
}
