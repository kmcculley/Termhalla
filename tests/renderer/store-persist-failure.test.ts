// 2026-07-17 whole-project quality audit, Finding 6: the debounced persistence writers `void`ed
// their IPC writes — a failed workspace autosave / quick-save / notes write vanished silently,
// and dirtyNotes was CLEARED before the writes settled so a failed note write was never retried.
// Now: each writer surfaces ONE error toast per failure streak (errors always render per the
// toast policy; a success re-arms the gate), and a notes key leaves dirtyNotes only after its
// notesSet RESOLVES with the written text still current — failure keeps it for the next flush.
//
// Real-store harness with the preload bridge mocked (the orky-cockpit-action.test.ts pattern).
import { describe, it, expect, vi } from 'vitest'
import { AUTOSAVE_DEBOUNCE_MS } from '../../src/renderer/timing'

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
const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0))
const errorToasts = (useStore: any): string[] =>
  (S(useStore).toasts as Array<{ kind: string; text: string }>).filter(t => t.kind === 'error').map(t => t.text)

describe('quick-save failures — one error toast per failure streak', () => {
  it('a failed saveQuick toasts once with the error detail; repeat failures stay silent; a success re-arms', async () => {
    const { useStore, api } = await freshStore()

    api.saveQuick.mockRejectedValueOnce(new Error('EIO quick-boom'))
    S(useStore).flushQuick()
    await tick()
    expect(errorToasts(useStore)).toHaveLength(1)
    expect(errorToasts(useStore)[0]).toContain('EIO quick-boom')

    api.saveQuick.mockRejectedValueOnce(new Error('EIO quick-boom'))
    S(useStore).flushQuick()
    await tick()
    expect(errorToasts(useStore), 'same failure streak — no toast spam').toHaveLength(1)

    S(useStore).flushQuick()   // default mock resolves — the streak ends
    await tick()
    api.saveQuick.mockRejectedValueOnce(new Error('second streak'))
    S(useStore).flushQuick()
    await tick()
    expect(errorToasts(useStore)).toHaveLength(2)
    expect(errorToasts(useStore)[1]).toContain('second streak')
  })
})

describe('notes save failures — the dirty key survives for retry', () => {
  it('a failed notesSet keeps the key dirty (next flush retries), toasts once, and a successful retry un-dirties it', async () => {
    const { useStore, api } = await freshStore()
    S(useStore).setNote('proj-a', 'v1')

    api.notesSet.mockRejectedValueOnce(new Error('disk full'))
    S(useStore).flushNotes()
    await tick()
    expect(api.notesSet).toHaveBeenCalledTimes(1)
    expect(errorToasts(useStore)).toHaveLength(1)
    expect(errorToasts(useStore)[0]).toContain('disk full')

    // The key must still be dirty: the next flush retries the SAME note.
    S(useStore).flushNotes()
    await tick()
    expect(api.notesSet, 'a failed note write must be retried on the next flush').toHaveBeenCalledTimes(2)
    expect(api.notesSet.mock.calls[1]).toEqual(['proj-a', 'v1'])

    // That retry succeeded — the key left the dirty set, so a further flush writes nothing.
    S(useStore).flushNotes()
    await tick()
    expect(api.notesSet).toHaveBeenCalledTimes(2)
  })

  it('an edit racing an in-flight write keeps the key dirty so the NEWER text still reaches disk', async () => {
    const { useStore, api } = await freshStore()
    let release!: () => void
    api.notesSet.mockImplementationOnce(() => new Promise<void>(r => { release = () => r() }))

    S(useStore).setNote('proj-b', 'old')
    S(useStore).flushNotes()               // write of 'old' in flight
    S(useStore).setNote('proj-b', 'new')   // edited while the write is pending
    release()
    await tick()

    S(useStore).flushNotes()
    await tick()
    const last = api.notesSet.mock.calls[api.notesSet.mock.calls.length - 1]
    expect(last, 'the newer edit must not be dropped by the stale write\'s settle').toEqual(['proj-b', 'new'])
  })
})

describe('workspace autosave failures — surfaced through the same streak gate', () => {
  it('a failed debounced saveAll pushes one error toast naming the failure', async () => {
    const { useStore, api } = await freshStore()
    useStore.setState({
      windowId: 'win-1',
      workspaces: { w1: { id: 'w1', name: 'W1', layout: null, panes: {} } },
      order: ['w1'],
      activeId: 'w1'
    })
    vi.useFakeTimers()
    try {
      api.saveWorkspace.mockRejectedValueOnce(new Error('ws-write-fail'))
      S(useStore).renameWorkspace('w1', 'renamed')   // schedules the debounced autosave
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 50)
      expect(errorToasts(useStore)).toHaveLength(1)
      expect(errorToasts(useStore)[0]).toContain('ws-write-fail')
    } finally {
      vi.useRealTimers()
    }
  })
})
