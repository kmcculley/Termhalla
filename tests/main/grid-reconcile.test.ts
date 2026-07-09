// Adopting a live PTY (minimize/restore, cross-workspace move, undock) re-mounts a TerminalPane that
// has already fitted itself to its NEW tile — but `pty:spawn` short-circuits on `pty.has(id)` and
// drops the renderer's cols/rows, so the PTY keeps the OLD grid. The remounted pane seeds its
// ResizeObserver guard from xterm (`lastCols = term.cols`), so the first fire sees no change and the
// discrepancy is never corrected: a permanent xterm/PTY desync that renders garbled and that Ctrl+L
// cannot fix. `needsGridReconcile` is the adopt-time probe that closes it — while preserving the
// no-redundant-resize rule (a redundant resize forces a ConPTY repaint that can evict the status tail).
import { describe, it, expect } from 'vitest'
import { needsGridReconcile } from '../../src/main/pty/grid-reconcile'

describe('needsGridReconcile — resize an adopted pty only when its grid really differs', () => {
  it('true when the adopted pty carries a different grid than the remounted pane fitted to', () => {
    expect(needsGridReconcile({ cols: 80, rows: 24 }, { cols: 120, rows: 40 })).toBe(true)
  })

  it('true for a rows-only or cols-only difference', () => {
    expect(needsGridReconcile({ cols: 80, rows: 24 }, { cols: 80, rows: 23 })).toBe(true)
    expect(needsGridReconcile({ cols: 80, rows: 24 }, { cols: 79, rows: 24 })).toBe(true)
  })

  it('false when the grids already agree — never issue a redundant resize', () => {
    expect(needsGridReconcile({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false)
  })

  it('false when the pty has no size (already exited / not tracked) — nothing to reconcile', () => {
    expect(needsGridReconcile(undefined, { cols: 80, rows: 24 })).toBe(false)
  })
})
