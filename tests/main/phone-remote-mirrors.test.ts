// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-001 (disabled means inert at the fan-out seam), REQ-008 (always-on bounded mirrors while
// enabled), REQ-015 (the renderer-forward path is byte-identical), REQ-026 (mirror ends with
// the pane), REQ-013 (mirror grid follows the DESKTOP resize). Contract set here for the
// implementer — src/main/phone-remote/mirror-manager.ts exports:
//   createMirrorManager(opts?: { replayFactory?: ReplayFactory }): MirrorManager
//   MirrorManager = {
//     registerPane(info: { paneId: string; cols: number; rows: number },
//                  forward: (chunk: string) => void): (chunk: string) => void
//       // returns the TAP installed on the pane-data path: it ALWAYS calls forward(chunk)
//       // (identical sequence, same order) and additionally feeds the pane's mirror while
//       // the server is enabled. This is the REQ-001/REQ-015 fan-out seam.
//     setEnabled(enabled: boolean): void   // true: create mirrors for all registered panes at
//                                          // their CURRENT grid; false: dispose every mirror
//     resizePane(paneId: string, cols: number, rows: number): void  // desktop-driven only
//     paneExited(paneId: string): void     // dispose + unregister
//     snapshot(paneId: string): Promise<string> | undefined
//     mirrorCount(): number
//   }
// The default replayFactory is the F18 createPaneReplay with HISTORY_LIMIT_DEFAULT scrollback.
import { describe, it, expect } from 'vitest'
import type { PaneReplayOpts, ReplayFactory } from '../../src/agent/replay'
import { HISTORY_LIMIT_DEFAULT } from '../../src/agent/replay'
import { createMirrorManager } from '../../src/main/phone-remote/mirror-manager'

interface FakeMirror {
  opts: PaneReplayOpts
  feeds: string[]
  resizes: Array<{ cols: number; rows: number }>
  disposed: boolean
}

const mkFakeFactory = (): { factory: ReplayFactory; created: FakeMirror[] } => {
  const created: FakeMirror[] = []
  const factory: ReplayFactory = (opts) => {
    const rec: FakeMirror = { opts, feeds: [], resizes: [], disposed: false }
    created.push(rec)
    return {
      feed: (d: string) => { rec.feeds.push(d) },
      resize: (cols: number, rows: number) => { rec.resizes.push({ cols, rows }) },
      snapshot: () => Promise.resolve(rec.feeds.join('')),
      dispose: () => { rec.disposed = true }
    }
  }
  return { factory, created }
}

describe('TEST-2620 REQ-001 disabled means inert at the fan-out seam', () => {
  it('while disabled, no mirror exists and no feed is performed — forward still gets every chunk', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    const forwarded: string[] = []
    const tap = mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, (c) => forwarded.push(c))
    tap('one')
    tap('two')
    expect(forwarded).toEqual(['one', 'two'])
    expect(created.length, 'the disabled path must create no mirrors').toBe(0)
    expect(mm.mirrorCount()).toBe(0)
    expect(mm.snapshot('A')).toBeUndefined()
  })

  it('enable -> disable returns to the inert state (all mirrors disposed)', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    const tap = mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, () => {})
    mm.setEnabled(true)
    expect(mm.mirrorCount()).toBe(1)
    mm.setEnabled(false)
    expect(mm.mirrorCount()).toBe(0)
    expect(created.every((m) => m.disposed)).toBe(true)
    // and post-disable chunks feed nothing
    tap('after-disable')
    expect(created.flatMap((m) => m.feeds)).not.toContain('after-disable')
  })
})

describe('TEST-2621 REQ-008 bounded mirrors while enabled', () => {
  it('registering (spawning) a pane while enabled creates exactly one mirror at the pane grid with the 2000-line bound', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    mm.setEnabled(true)
    mm.registerPane({ paneId: 'A', cols: 120, rows: 30 }, () => {})
    expect(created.length).toBe(1)
    expect(created[0].opts.cols).toBe(120)
    expect(created[0].opts.rows).toBe(30)
    expect(created[0].opts.scrollback).toBe(HISTORY_LIMIT_DEFAULT)
    expect(HISTORY_LIMIT_DEFAULT).toBe(2000)
  })

  it('enabling creates mirrors for ALL already-registered panes at their CURRENT grid', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, () => {})
    mm.registerPane({ paneId: 'B', cols: 100, rows: 40 }, () => {})
    // the desktop resized A while the server was still disabled — enable must use the NEW grid
    mm.resizePane('A', 132, 43)
    mm.setEnabled(true)
    expect(created.length).toBe(2)
    const a = created.find((m) => m.opts.cols === 132)
    expect(a, 'pane A mirror must be created at its current 132x43 grid').toBeDefined()
    expect(a?.opts.rows).toBe(43)
  })

  it('fed output is in the snapshot (real F18 replay as the default-factory stand-in discipline)', async () => {
    // Uses the REAL createPaneReplay through the manager: feed then attach yields the output.
    const mm = createMirrorManager()
    mm.setEnabled(true)
    const tap = mm.registerPane({ paneId: 'A', cols: 40, rows: 6 }, () => {})
    tap('hello-from-pane\r\n')
    const snap = await mm.snapshot('A')
    expect(snap).toContain('hello-from-pane')
  })

  it('remote-workspace pane bytes ride the SAME discipline (the seam is source-agnostic)', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    mm.setEnabled(true)
    const tapLocal = mm.registerPane({ paneId: 'local-1', cols: 80, rows: 24 }, () => {})
    const tapRemote = mm.registerPane({ paneId: 'remote-1', cols: 80, rows: 24 }, () => {})
    tapLocal('L')
    tapRemote('R')
    expect(created.find((m) => m.feeds.includes('L'))).toBeDefined()
    expect(created.find((m) => m.feeds.includes('R'))).toBeDefined()
  })
})

describe('TEST-2622 REQ-015 the renderer forward is byte-identical, enabled or not', () => {
  it('forward receives the identical chunk sequence with and without an attached mirror', () => {
    const { factory } = mkFakeFactory()
    const chunks = ['a', '\x1b[31mred\x1b[0m', 'b\r\n', '', 'c']
    const run = (enable: boolean): string[] => {
      const mm = createMirrorManager({ replayFactory: factory })
      const forwarded: string[] = []
      const tap = mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, (c) => forwarded.push(c))
      if (enable) mm.setEnabled(true)
      for (const c of chunks) tap(c)
      return forwarded
    }
    expect(run(false)).toEqual(chunks)
    expect(run(true)).toEqual(chunks)
  })

  it('a throwing mirror feed never breaks the renderer forward (the desktop path is protected)', () => {
    const throwing: ReplayFactory = () => ({
      feed: () => { throw new Error('mirror exploded') },
      resize: () => {},
      snapshot: () => Promise.resolve(''),
      dispose: () => {}
    })
    const mm = createMirrorManager({ replayFactory: throwing })
    const forwarded: string[] = []
    const tap = mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, (c) => forwarded.push(c))
    mm.setEnabled(true)
    expect(() => tap('chunk')).not.toThrow()
    expect(forwarded).toEqual(['chunk'])
  })
})

describe('TEST-2623 REQ-026 the mirror ends with the pane', () => {
  it('paneExited disposes the mirror and the count returns to the live-pane count', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    mm.setEnabled(true)
    mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, () => {})
    mm.registerPane({ paneId: 'B', cols: 80, rows: 24 }, () => {})
    expect(mm.mirrorCount()).toBe(2)
    mm.paneExited('A')
    expect(mm.mirrorCount()).toBe(1)
    expect(created.filter((m) => m.disposed).length).toBe(1)
    expect(mm.snapshot('A')).toBeUndefined()
  })
})

describe('TEST-2624 REQ-013 the mirror grid follows the DESKTOP resize only', () => {
  it('resizePane resizes the live mirror to the new desktop grid', () => {
    const { factory, created } = mkFakeFactory()
    const mm = createMirrorManager({ replayFactory: factory })
    mm.setEnabled(true)
    mm.registerPane({ paneId: 'A', cols: 80, rows: 24 }, () => {})
    mm.resizePane('A', 100, 30)
    expect(created[0].resizes).toEqual([{ cols: 100, rows: 30 }])
  })
})
