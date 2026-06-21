import { describe, it, expect, vi } from 'vitest'
import { redraw, FORM_FEED, type RedrawDeps } from '../../src/renderer/components/redraw'

/** Build RedrawDeps with spies + a controllable scheduler so we can assert the deferred restore. */
function harness(cols = 80, rows = 24) {
  const calls: { resize: Array<{ cols: number; rows: number }>; write: string[] } = { resize: [], write: [] }
  let deferred: (() => void) | undefined
  const deps: RedrawDeps = {
    fit: vi.fn(),
    repaint: vi.fn(),
    dims: () => ({ cols, rows }),
    resize: (s) => { calls.resize.push(s) },
    write: (d) => { calls.write.push(d) },
    schedule: (fn) => { deferred = fn },
  }
  return { deps, calls, flush: () => deferred?.() }
}

describe('redraw (aggressive Redraw terminal action)', () => {
  it('re-fits and repaints xterm synchronously', () => {
    const { deps } = harness()
    redraw(deps)
    expect(deps.fit).toHaveBeenCalledOnce()
    expect(deps.repaint).toHaveBeenCalledOnce()
  })

  it('shrinks the PTY grid first so the resize cannot be coalesced into a no-op', () => {
    const { deps, calls } = harness(80, 24)
    redraw(deps)
    // Synchronous part: one distinctly-smaller resize, no restore and no input yet.
    expect(calls.resize).toEqual([{ cols: 78, rows: 22 }])
    expect(calls.write).toEqual([])
  })

  it('restores the fitted grid and sends Ctrl+L on the deferred tick', () => {
    const { deps, calls, flush } = harness(80, 24)
    redraw(deps)
    flush()
    expect(calls.resize).toEqual([{ cols: 78, rows: 22 }, { cols: 80, rows: 24 }])
    expect(calls.write).toEqual([FORM_FEED])
    expect(FORM_FEED).toBe('\x0c')
  })

  it('repaints again after the grid is restored', () => {
    const { deps, flush } = harness()
    redraw(deps)
    flush()
    expect(deps.repaint).toHaveBeenCalledTimes(2)
  })

  it('never resizes below a 1x1 grid on a tiny terminal', () => {
    const { deps, calls, flush } = harness(1, 1)
    redraw(deps)
    flush()
    expect(calls.resize).toEqual([{ cols: 1, rows: 1 }, { cols: 1, rows: 1 }])
  })
})
