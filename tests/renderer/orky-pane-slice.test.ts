// FROZEN unit suite — feature 0009-native-orky-pane (phase 4 / TASK-010).
// REQ-010 (pinned refresh triggers: coalescing, hidden/stale suppression, issue-time discard) /
// REQ-011 (stale-but-valid detail retained across a failed refresh) / REQ-016 (per-root targeted
// fan-out — other-root notifications touch NOTHING, reference-stable) / REQ-005 (fold-INJECTED
// binding equality on the fan-out path) / REQ-017 (clearPaneRuntime pruning) / REQ-022 (the
// notification is the ONLY change-driven fetch trigger).
//
// No jsdom: the slice is driven as plain objects (03-plan.md "Testability constraint"; the F6
// registry-slice harness pattern). Chosen contract (prose-only in spec/plan — frozen here):
//
//   src/renderer/store/orky-pane-slice.ts exports
//     createOrkyPaneSlice(deps: {
//       set, get,                                                    // zustand pair
//       registryDetail: (root: string) => Promise<OrkyRootDetailResult>,  // the preload bridge, INJECTED
//       caseFold: boolean,                                           // derived ONCE via caseFoldFromPlatform(navigator.platform) at composition — the slice never reads ambient platform state
//       updatePaneConfig: (wsId: string, paneId: string, patch: { root: string }) => void
//     }): {
//       fetchOrkyDetail(paneId: string, root: string): void          // T1 bind-event trigger
//       notifyOrkyRootChanged(root: string): void                    // T2/T3 — App routes onRegistryRootChanged here
//       setOrkyPaneHidden(paneId: string, hidden: boolean): void     // the displayed/hidden boundary hook (MinimizedPaneHost)
//       rebindOrkyPane(wsId: string, paneId: string, root: string): void
//     }
//   over state field
//     orkyPaneDetail: Record<paneId, { root: string; detail: OrkyRootDetailResult | null;
//       error: string | null; inFlight: boolean; pendingRefetch: boolean; stale: boolean; hidden: boolean }>
//
// Runs RED today: src/renderer/store/orky-pane-slice.ts does not exist (module-not-found), and
// clearPaneRuntime does not prune orkyPaneDetail yet.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/renderer/api', () => ({ api: {} })) // internals.ts re-exports api-touching helpers

import { createOrkyPaneSlice } from '../../src/renderer/store/orky-pane-slice'
import { clearPaneRuntime } from '../../src/renderer/store/internals'

type DetailStub = { ok: true; root: string; activeFeature: null; computedAt: number; features: never[]; skippedFeatures: never[]; featuresCapped: false }
const okPayload = (root: string): DetailStub =>
  ({ ok: true, root, activeFeature: null, computedAt: 1, features: [], skippedFeatures: [], featuresCapped: false })
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))

interface Entry { root: string; detail: unknown; error: string | null; inFlight: boolean; pendingRefetch: boolean; stale: boolean; hidden: boolean }

function harness(opts: { caseFold?: boolean; seed?: Record<string, Partial<Entry>> } = {}) {
  let state: { orkyPaneDetail: Record<string, Entry> } = {
    orkyPaneDetail: Object.fromEntries(Object.entries(opts.seed ?? {}).map(([id, e]) => [id, {
      root: '', detail: null, error: null, inFlight: false, pendingRefetch: false, stale: false, hidden: false, ...e
    }]))
  }
  const setCalls: unknown[] = []
  const set = (patch: unknown) => {
    setCalls.push(patch)
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state as never
  const pending: Array<{ root: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const registryDetail = vi.fn((root: string) => new Promise((resolve, reject) => { pending.push({ root, resolve, reject }) }))
  const updatePaneConfig = vi.fn()
  const slice = createOrkyPaneSlice({ set, get, registryDetail, caseFold: opts.caseFold ?? true, updatePaneConfig } as never)
  return { slice, get: () => state, setCalls, registryDetail, updatePaneConfig, pending }
}

const A = 'C:\\Dev\\ProjA'
const B = 'C:\\Dev\\ProjB'
const C = 'C:\\Dev\\ProjC'

describe('T1 bind-event fetch + settle (REQ-010)', () => {
  it('TEST-420 REQ-010 fetchOrkyDetail issues exactly one request, marks inFlight, and holds the settled payload for the still-current binding', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    expect(h.registryDetail).toHaveBeenCalledTimes(1)
    expect(h.registryDetail).toHaveBeenCalledWith(A)
    expect(h.get().orkyPaneDetail.p1.inFlight).toBe(true)
    expect(h.get().orkyPaneDetail.p1.root).toBe(A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    const entry = h.get().orkyPaneDetail.p1
    expect(entry.inFlight).toBe(false)
    expect(entry.detail).toEqual(okPayload(A))
    expect(entry.error).toBeNull()
  })

  it('TEST-421 REQ-010 REQ-022 three rapid own-root notifications during ONE in-flight fetch coalesce into exactly ONE follow-up', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    expect(h.registryDetail).toHaveBeenCalledTimes(1)
    h.slice.notifyOrkyRootChanged(A)
    h.slice.notifyOrkyRootChanged(A)
    h.slice.notifyOrkyRootChanged(A)
    expect(h.registryDetail).toHaveBeenCalledTimes(1) // no concurrent second call — coalesced
    expect(h.get().orkyPaneDetail.p1.pendingRefetch).toBe(true)
    h.pending[0].resolve(okPayload(A))
    await flush()
    expect(h.registryDetail).toHaveBeenCalledTimes(2) // exactly one follow-up
    h.pending[1].resolve(okPayload(A))
    await flush()
    expect(h.registryDetail).toHaveBeenCalledTimes(2) // and nothing further
    expect(h.get().orkyPaneDetail.p1.pendingRefetch).toBe(false)
  })
})

describe('per-root targeted fan-out — other roots touch NOTHING (REQ-016 / REQ-005)', () => {
  it('TEST-422 REQ-016 a notification for another root causes zero fetches, zero state writes, and keeps the orkyPaneDetail reference identical', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    const callsBefore = h.registryDetail.mock.calls.length
    const setBefore = h.setCalls.length
    const mapRef = h.get().orkyPaneDetail
    const entryRef = h.get().orkyPaneDetail.p1
    h.slice.notifyOrkyRootChanged(B)
    expect(h.registryDetail.mock.calls.length).toBe(callsBefore) // zero fetches
    expect(h.setCalls.length).toBe(setBefore)                    // zero store notifications
    expect(h.get().orkyPaneDetail).toBe(mapRef)                  // reference-stable → zero re-renders possible
    expect(h.get().orkyPaneDetail.p1).toBe(entryRef)
  })

  it('TEST-426 REQ-005 REQ-022 fan-out matching is fold-INJECTED sameProjectRoot equality: slash-divergent always matches, case-divergent iff caseFold, and an UNBOUND (empty-root) entry never fetches', async () => {
    // caseFold: true — case- and slash-divergent notifications both match
    const h1 = harness({ caseFold: true })
    h1.slice.fetchOrkyDetail('p1', A)
    h1.pending[0].resolve(okPayload(A))
    await flush()
    h1.slice.notifyOrkyRootChanged('C:/Dev/ProjA')      // slash-divergent
    expect(h1.registryDetail).toHaveBeenCalledTimes(2)
    h1.pending[1].resolve(okPayload(A))
    await flush()
    h1.slice.notifyOrkyRootChanged('c:\\dev\\proja')    // case-divergent
    expect(h1.registryDetail).toHaveBeenCalledTimes(3)
    h1.pending[2].resolve(okPayload(A))
    await flush()

    // caseFold: false — the case-divergent spelling must NOT match
    const h2 = harness({ caseFold: false })
    h2.slice.fetchOrkyDetail('p1', A)
    h2.pending[0].resolve(okPayload(A))
    await flush()
    h2.slice.notifyOrkyRootChanged('c:\\dev\\proja')
    expect(h2.registryDetail).toHaveBeenCalledTimes(1)  // no fetch
    h2.slice.notifyOrkyRootChanged('C:/Dev/ProjA')      // slash style folds ALWAYS
    expect(h2.registryDetail).toHaveBeenCalledTimes(2)
    h2.pending[1].resolve(okPayload(A))
    await flush()

    // an unbound entry (root '') never fetches — not even for a '' notification
    const h3 = harness({ seed: { p9: { root: '' } } })
    h3.slice.notifyOrkyRootChanged('')
    h3.slice.notifyOrkyRootChanged(A)
    expect(h3.registryDetail).not.toHaveBeenCalled()
  })
})

describe('hidden/displayed boundary — T3 stale suppression (REQ-010)', () => {
  it('TEST-423 REQ-010 a hidden pane marks stale on its own-root notification (no fetch); un-hiding with stale fetches EXACTLY once; un-hiding without stale fetches zero times', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    h.slice.setOrkyPaneHidden('p1', true)
    h.slice.notifyOrkyRootChanged(A)
    h.slice.notifyOrkyRootChanged(A)
    expect(h.registryDetail).toHaveBeenCalledTimes(1) // hidden: fetches nothing
    expect(h.get().orkyPaneDetail.p1.stale).toBe(true)
    h.slice.setOrkyPaneHidden('p1', false)            // restore
    expect(h.registryDetail).toHaveBeenCalledTimes(2) // exactly one stale-restore fetch
    expect(h.get().orkyPaneDetail.p1.stale).toBe(false)
    h.pending[1].resolve(okPayload(A))
    await flush()
    // hide/restore with NO suppressed notification: no fetch
    h.slice.setOrkyPaneHidden('p1', true)
    h.slice.setOrkyPaneHidden('p1', false)
    expect(h.registryDetail).toHaveBeenCalledTimes(2)
  })
})

describe('issue-time guard + rebind (REQ-010 / REQ-011)', () => {
  it('TEST-424 REQ-010 a response settling AFTER the pane re-bound is DISCARDED (latest root wins); rebind persists via updatePaneConfig and fetches fresh', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)          // in-flight for A
    h.slice.rebindOrkyPane('w1', 'p1', C)     // re-bind mid-flight
    expect(h.updatePaneConfig).toHaveBeenCalledWith('w1', 'p1', expect.objectContaining({ root: C }))
    expect(h.get().orkyPaneDetail.p1.root).toBe(C)
    h.pending[0].resolve(okPayload(A))        // A's response settles late
    await flush()
    const entry = h.get().orkyPaneDetail.p1
    expect(entry.detail).toBeNull()           // A's stale payload never applied
    // the coalesced follow-up targets the CURRENT binding
    const lastCall = h.registryDetail.mock.calls[h.registryDetail.mock.calls.length - 1]
    expect(lastCall[0]).toBe(C)
    h.pending[h.pending.length - 1].resolve(okPayload(C))
    await flush()
    expect((h.get().orkyPaneDetail.p1.detail as { root: string }).root).toBe(C)
  })

  it('TEST-425 REQ-011 a FAILED refresh keeps the stale-but-valid detail rendering (error surfaced alongside); a later success clears the error', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    expect(h.get().orkyPaneDetail.p1.detail).toEqual(okPayload(A))
    // refresh fails (rejected bridge call)
    h.slice.notifyOrkyRootChanged(A)
    h.pending[1].reject(new Error('ipc torn down'))
    await flush()
    const entry = h.get().orkyPaneDetail.p1
    expect(entry.detail).toEqual(okPayload(A))          // never blanked
    expect(typeof entry.error).toBe('string')           // surfaced, specific
    expect((entry.error as string).length).toBeGreaterThan(0)
    // a later successful fetch clears it
    h.slice.notifyOrkyRootChanged(A)
    h.pending[2].resolve(okPayload(A))
    await flush()
    expect(h.get().orkyPaneDetail.p1.error).toBeNull()
  })
})

describe('runtime-state hygiene (REQ-017 / CONV-011)', () => {
  it('TEST-427 REQ-017 clearPaneRuntime drops the cleared panes\' orkyPaneDetail entries and keeps the others (close, workspace close, AND move-away route here)', () => {
    const entry = (root: string): Entry =>
      ({ root, detail: null, error: null, inFlight: false, pendingRefetch: false, stale: false, hidden: false })
    const state = {
      statuses: {}, cwds: {}, procs: {}, aiSessions: {}, usage: {}, recording: {}, gitStatus: {}, exited: {}, paneFocusSeq: {},
      orkyPaneDetail: { p1: entry(A), p2: entry(B) }
    } as never
    const out = clearPaneRuntime(state, ['p1']) as unknown as { orkyPaneDetail: Record<string, Entry> }
    expect(out.orkyPaneDetail.p1).toBeUndefined()
    expect(out.orkyPaneDetail.p2).toBeDefined()
    expect(out.orkyPaneDetail.p2.root).toBe(B)
  })
})
