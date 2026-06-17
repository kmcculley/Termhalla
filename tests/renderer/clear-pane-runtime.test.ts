import { describe, it, expect, vi } from 'vitest'

// internals.ts re-exports teardownPanes which calls api (window.termhalla) — mock it so
// the pure clearPaneRuntime can be imported in the node test environment.
vi.mock('../../src/renderer/api', () => ({ api: {} }))

import { clearPaneRuntime } from '../../src/renderer/store/internals'
import type { State } from '../../src/renderer/store/types'

// clearPaneRuntime only reads the per-pane maps; cast a minimal partial to State.
function stateWith(): State {
  return {
    statuses: { p1: { state: 'idle' } as never, p2: { state: 'idle' } as never },
    cwds: { p1: '/a', p2: '/b' },
    procs: {}, aiSessions: {}, usage: {}, recording: {},
    gitStatus: { p1: { root: '/a', branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false }, p2: { root: '/b', branch: 'dev', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: true } }
  } as unknown as State
}

describe('clearPaneRuntime', () => {
  it('drops gitStatus for the cleared panes (and keeps the others)', () => {
    const out = clearPaneRuntime(stateWith(), ['p1'])
    expect(out.gitStatus.p1).toBeUndefined()
    expect(out.gitStatus.p2).toBeDefined()
  })
})
