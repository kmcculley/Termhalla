// A `fit()` that is not paired with a `ptyResize` silently desyncs xterm's grid from the program's:
// FitAddon.fit() calls term.resize() internally and NOTHING listens to term.onResize, so the PTY
// keeps its old cols/rows. The program then draws at the old width into a terminal of a new width —
// garbled output that Ctrl+L cannot fix (the program just redraws at the same wrong width); only a
// real resize re-syncs it, which is why maximizing the pane "fixes" it.
//
// syncGrid is the one place that pairs the two. Pure (deps injected) per the repo's renderer-unit
// rule — it must never import ../api. Rendered behavior lives in the e2e suites.
import { describe, it, expect, vi } from 'vitest'
import { syncGrid, type GridSyncDeps } from '../../src/renderer/components/grid-sync'

/** Deps over a mutable fake terminal whose `fit` snaps the grid to `next`. */
function harness(start = { cols: 80, rows: 24 }) {
  let grid = { ...start }
  let last = { ...start }
  const resizes: Array<{ cols: number; rows: number }> = []
  const deps: GridSyncDeps = {
    fit: vi.fn(),
    dims: () => grid,
    last: () => last,
    setLast: (d) => { last = d },
    resize: (d) => { resizes.push(d) }
  }
  return { deps, resizes, refit: (d: { cols: number; rows: number }) => { grid = d }, lastSeen: () => last }
}

describe('syncGrid — fit xterm, then tell the PTY iff the grid actually changed', () => {
  it('always fits', () => {
    const { deps } = harness()
    syncGrid(deps)
    expect(deps.fit).toHaveBeenCalledOnce()
  })

  it('does NOT resize the PTY when the fitted grid is unchanged', () => {
    // A redundant resize forces a ConPTY repaint, which can evict the status tail. The guard that
    // prevents that is exactly why an unpaired fit() goes unnoticed — so it stays.
    const { deps, resizes } = harness()
    expect(syncGrid(deps)).toBe(false)
    expect(resizes).toEqual([])
  })

  it('resizes the PTY when the fitted grid changed, and records the new grid', () => {
    const { deps, resizes, refit, lastSeen } = harness({ cols: 80, rows: 24 })
    refit({ cols: 92, rows: 30 })   // e.g. a Ctrl+wheel font zoom re-grids xterm
    expect(syncGrid(deps)).toBe(true)
    expect(resizes).toEqual([{ cols: 92, rows: 30 }])
    expect(lastSeen()).toEqual({ cols: 92, rows: 30 })
  })

  it('a second call after a change is a no-op (the new grid became the baseline)', () => {
    const { deps, resizes, refit } = harness()
    refit({ cols: 92, rows: 30 })
    syncGrid(deps)
    expect(syncGrid(deps)).toBe(false)
    expect(resizes).toHaveLength(1)
  })

  it('detects a rows-only change (the 1px pane-chrome case)', () => {
    const { deps, resizes, refit } = harness({ cols: 80, rows: 24 })
    refit({ cols: 80, rows: 23 })
    expect(syncGrid(deps)).toBe(true)
    expect(resizes).toEqual([{ cols: 80, rows: 23 }])
  })
})
