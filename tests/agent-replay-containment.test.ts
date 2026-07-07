// 2026-07-06 quality-audit Group A #2: `addon.serialize()` in drain() runs inside xterm's async
// `term.write` callback, where NO caller try/catch reaches (session-store's FINDING-009 guard
// covers only the synchronous snapshot() fast path). A throw there is an uncaughtException —
// in the daemon that kills every surviving pane — and the parked waiters hang forever.
// These tests pin the containment: waiters settle with a degraded empty snapshot + diagnostic
// (the feedReplay containment posture), and dispose() never throws upward.
//
// replay.ts is the ONLY sanctioned importer of @xterm/addon-serialize (TEST-1910), so a module
// mock is the only seam to make serialize() throw. The frozen fidelity oracles
// (agent-replay.test.ts) keep covering the real addon — this file never asserts on fidelity.
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ throwing: false }))

vi.mock('@xterm/addon-serialize', () => {
  class SerializeAddon {
    activate(): void {}
    dispose(): void {}
    serialize(): string {
      if (state.throwing) throw new Error('serialize boom')
      return 'SNAP'
    }
  }
  return { SerializeAddon }
})

import { createPaneReplay } from '../src/agent/replay'

const OPTS = { cols: 20, rows: 5, scrollback: 8 }

describe('replay serialize containment (drain/dispose must never throw upward)', () => {
  it('a serialize throw inside the write barrier settles the waiter degraded + diagnostic', async () => {
    const diags: string[] = []
    const replay = createPaneReplay({ ...OPTS, diag: (t) => diags.push(t) })
    replay.feed('hello')
    state.throwing = true
    try {
      const snap = await replay.snapshot() // parked waiter; drain fires in xterm's write callback
      expect(snap).toBe('')
      expect(diags.length).toBeGreaterThan(0)
    } finally {
      state.throwing = false
      replay.dispose()
    }
  })

  it('dispose() with a throwing serialize settles pending waiters and never throws', async () => {
    const diags: string[] = []
    const replay = createPaneReplay({ ...OPTS, diag: (t) => diags.push(t) })
    replay.feed('data')
    const pending = replay.snapshot() // parked: xterm has not parsed the chunk yet
    state.throwing = true
    try {
      expect(() => replay.dispose()).not.toThrow()
      await expect(pending).resolves.toBe('')
      expect(diags.length).toBeGreaterThan(0)
    } finally {
      state.throwing = false
    }
  })

  it('the healthy path is untouched: waiter resolves the real serialize result, no diagnostic', async () => {
    const diags: string[] = []
    const replay = createPaneReplay({ ...OPTS, diag: (t) => diags.push(t) })
    replay.feed('ok')
    await expect(replay.snapshot()).resolves.toBe('SNAP')
    expect(diags).toEqual([])
    replay.dispose()
  })
})
