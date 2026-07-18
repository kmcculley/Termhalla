// 2026-07-17 whole-project quality audit, Finding 4: App.tsx wires
// `api.onWinAssignment(a => { void s().applyAssignment(a) })` UNSERIALIZED, so assignment A's
// `Promise.all(loadWorkspace)` await can settle AFTER assignment B already committed. A's commit
// then computes from A's STALE workspaceIds and treats B's newly-added workspace as departed —
// deleting it (and clearing its panes' runtime) with no correcting push. applyAssignment now
// carries an issue-time monotonic generation (the registry slice's applyRecoveryPull pattern):
// a superseded call abandons its commit AND the trailing main-window starter-workspace seed.
//
// Drives the REAL renderer store with the preload bridge mocked (the orky-cockpit-action.test.ts
// harness) — the race lives across the store's own await, so a slice-only harness can't catch it.
import { describe, it, expect, vi } from 'vitest'
import type { Workspace } from '../../src/shared/types'

vi.mock('../../src/renderer/api', () => ({
  api: {
    winReport: vi.fn(),
    loadWorkspace: vi.fn(async () => null),
    saveWorkspace: vi.fn(async () => {}),
    saveQuick: vi.fn(async () => {}),
    notesSet: vi.fn(async () => {}),
    termSnapshot: vi.fn(),
    ptyTransitBegin: vi.fn(),
    registryDetail: vi.fn(async () => ({ ok: false }))
  }
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mocked = Record<string, ReturnType<typeof vi.fn>>

async function freshStore(): Promise<{ useStore: any; api: Mocked }> {
  vi.resetModules()
  vi.clearAllMocks()   // spy instances survive resetModules — drop call history between tests
  vi.stubGlobal('navigator', { platform: 'Win32' })
  const { useStore } = await import('../../src/renderer/store')
  const { api } = await import('../../src/renderer/api')
  return { useStore, api: api as unknown as Mocked }
}

const S = (useStore: any): any => useStore.getState()

const rec = (id: string): Workspace => ({ id, name: id, layout: null, panes: {} })

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('applyAssignment — a superseded assignment abandons its commit (newest wins)', () => {
  it('assignment A settling AFTER assignment B committed must NOT delete B\'s newly-added workspace', async () => {
    const { useStore, api } = await freshStore()
    useStore.setState({ windowId: 'win-1', isMainWindow: true })

    // A's load of w1 (the FIRST loadWorkspace('w1') call) is gated; every later load resolves
    // immediately, so B fully settles while A is still awaiting.
    const gate = deferred<void>()
    let firstW1 = true
    api.loadWorkspace.mockImplementation(async (id: string) => {
      if (id === 'w1' && firstW1) { firstW1 = false; await gate.promise }
      return rec(id)
    })

    const pA = S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: ['w1'], activeId: 'w1' })
    const pB = S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: ['w1', 'w2'], activeId: 'w2' })
    await pB
    expect(S(useStore).workspaces.w2, 'B committed w2').toBeDefined()
    expect(S(useStore).order).toEqual(['w1', 'w2'])

    gate.resolve()
    await pA

    // Without the generation guard, A's stale commit treats w2 as departed and deletes it.
    expect(S(useStore).workspaces.w2, 'the superseded assignment must abandon its commit — w2 survives').toBeDefined()
    expect(S(useStore).workspaces.w1).toBeDefined()
    expect(S(useStore).order).toEqual(['w1', 'w2'])
    expect(S(useStore).activeId).toBe('w2')
  })

  it('a superseded assignment also abandons the trailing main-window starter-workspace seed', async () => {
    const { useStore, api } = await freshStore()
    useStore.setState({ windowId: 'win-1', isMainWindow: true })

    // A's sole workspace fails to load (null) — an un-abandoned A would commit an EMPTY window,
    // delete B's w2, and then seed a phantom 'Workspace 1'.
    const gate = deferred<void>()
    api.loadWorkspace.mockImplementation(async (id: string) => {
      if (id === 'w-gone') { await gate.promise; return null }
      return rec(id)
    })

    const pA = S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: ['w-gone'], activeId: 'w-gone' })
    const pB = S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: ['w2'], activeId: 'w2' })
    await pB
    gate.resolve()
    await pA

    expect(Object.keys(S(useStore).workspaces)).toEqual(['w2'])
    expect(S(useStore).order).toEqual(['w2'])
    const names = Object.values(S(useStore).workspaces).map((w: any) => w.name)
    expect(names, 'no phantom starter workspace from the abandoned seed').not.toContain('Workspace 1')
  })

  it('control: a single un-superseded assignment still commits fully (loads, orders, activates, seeds)', async () => {
    const { useStore, api } = await freshStore()
    useStore.setState({ windowId: 'win-1', isMainWindow: true })
    api.loadWorkspace.mockImplementation(async (id: string) => rec(id))

    await S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: ['w1', 'w2'], activeId: 'w1' })
    expect(S(useStore).order).toEqual(['w1', 'w2'])
    expect(S(useStore).activeId).toBe('w1')

    // The cold-first-run seed still fires when the (latest) assignment leaves a main window empty.
    await S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: [], activeId: null })
    expect(S(useStore).order.length, 'the main window re-seeds a starter workspace').toBe(1)
    const seeded = S(useStore).workspaces[S(useStore).order[0]]
    expect(seeded.name).toBe('Workspace 1')
  })
})
