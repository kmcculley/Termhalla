/** Should an ADOPTED pty be resized to the grid the remounting pane just fitted itself to?
 *
 *  `pty:spawn` is idempotent: a pane that moved (minimize/restore, cross-workspace move, undock)
 *  re-spawns, main sees the live session and adopts it instead. But the remounted `TerminalPane` has
 *  already fitted xterm to its NEW tile, while the adopted pty still carries the OLD grid — and the
 *  pane seeds its ResizeObserver guard from xterm (`lastCols = term.cols`), so the observer's first
 *  fire sees no change and the discrepancy is never corrected. The program then draws at the old
 *  width into a terminal of a new width: garbled output that Ctrl+L cannot fix (the program just
 *  redraws at the same wrong width). Only a real resize re-syncs them — which is why maximizing the
 *  pane appears to "fix" it.
 *
 *  Reconcile at adopt time, but ONLY on a genuine difference: a redundant resize forces a ConPTY
 *  repaint (see CLAUDE.md → "Avoid redundant PTY resizes"). An untracked/exited pty has no size and
 *  nothing to reconcile. */
export function needsGridReconcile(
  current: { cols: number; rows: number } | undefined,
  want: { cols: number; rows: number }
): boolean {
  if (!current) return false
  return current.cols !== want.cols || current.rows !== want.rows
}
