// FROZEN loopback suite — feature 0009-native-orky-pane (phase 4, ESC-001 tests loopback).
// Pins the AMENDED REQ-010 (spec amended 2026-07-02): "displayed" redefined against the REAL
// keep-mounted workspace mount model (FINDING-013), remount-grounded restore/re-bind fetch counts
// (FINDING-020), the mid-flight hidden/unbound follow-up conversion (FINDING-031), and the re-bind
// held-detail clearing that keeps a previous root's payload from rendering as the new root's
// (FINDING-029).
//
// Harness constraint (03-plan.md): node-env vitest, no jsdom — a React component lifecycle cannot
// be mounted here. The amended contract is therefore pinned two ways, per the coordinator's
// loopback direction:
//   (a) STRUCTURAL pins on the wiring the spec normatively names — PaneTile/OrkyPane must thread
//       workspace activity into the pane's effective `hidden` (REQ-010: "the pane's effective
//       hidden state MUST thread workspace activity in"), and the mount/bind effect must consult
//       the surviving orkyPaneDetail entry via getState() at event time (REQ-010 T3: "the mount/
//       bind effect MUST NOT treat a restore-remount as a fresh T1 bind ... consult it via
//       getState() at event time, CONV-021");
//   (b) registryDetail CALL-COUNT spies at the slice seam for every count the amended trigger ×
//       state matrix pins that IS drivable there.
// The true end-to-end component-lifecycle behavior (real remount between hosts) remains an e2e
// concern; the structural pins here are what closes the FINDING-020 class in the npm-test gate.
//
// Runs RED today (2026-07-02, against the shipped F9 implementation): PaneTile mounts OrkyPane
// with no hidden prop, OrkyPane's mount effect never consults getState(), settle() issues the
// coalesced follow-up regardless of a mid-flight hide, and rebindOrkyPane leaves the previous
// root's payload held.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../src/renderer/api', () => ({ api: {} }))

import { createOrkyPaneSlice } from '../../src/renderer/store/orky-pane-slice'
import { sameProjectRoot } from '@shared/orky-pane'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

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
  const set = (patch: unknown) => {
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state as never
  const pending: Array<{ root: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const registryDetail = vi.fn((root: string) => new Promise((resolve, reject) => { pending.push({ root, resolve, reject }) }))
  const updatePaneConfig = vi.fn()
  const slice = createOrkyPaneSlice({ set, get, registryDetail, caseFold: opts.caseFold ?? true, updatePaneConfig } as never)
  return { slice, get: () => state, registryDetail, updatePaneConfig, pending }
}

const A = 'C:\\Dev\\ProjA'
const C = 'C:\\Dev\\ProjC'

describe('the effective hidden boundary covers BOTH keep-mounted hosts (REQ-010 / FINDING-013)', () => {
  it('TEST-446 REQ-010 STRUCTURAL: workspace activity is threaded into OrkyPane\'s hidden state — the tile host passes hidden={…} (or the pane derives it from activeId), and the minimized host keeps passing hidden', () => {
    const paneTile = read('src/renderer/components/PaneTile.tsx')
    const orkyPane = read('src/renderer/components/OrkyPane.tsx')
    const minHost = read('src/renderer/components/MinimizedPaneHost.tsx')
    // The INACTIVE-workspace host (App.tsx keeps every workspace mounted, visibility:hidden) is the
    // second hidden host the amended REQ-010 pins. Either the tile mount passes an effective-hidden
    // expression into OrkyPane, or OrkyPane derives workspace activity itself — one MUST hold.
    const tilePassesHidden = /<OrkyPane[^>]*\bhidden=\{/s.test(paneTile)
    const paneDerivesActivity = /\bactiveId\b/.test(orkyPane)
    expect(tilePassesHidden || paneDerivesActivity,
      'a background-workspace OrkyPane must be effectively hidden (FINDING-013): PaneTile must pass hidden={workspace not active} into OrkyPane, or OrkyPane must derive it from the active-workspace state').toBe(true)
    // the minimized host's half of the boundary stays wired
    expect(minHost).toMatch(/<OrkyPane[^>]*\bhidden\b/s)
    // and the slice hook remains the single boundary seam BOTH hosts drive
    expect(orkyPane).toContain('setOrkyPaneHidden')
  })

  it('TEST-447 REQ-010 slice counts: a hidden (background-workspace/minimized) pane sustains ZERO fetches through N≥3 rapid own-root notifications and marks stale; becoming displayed fetches exactly once iff stale, zero times otherwise', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    expect(h.registryDetail).toHaveBeenCalledTimes(1)

    // background-workspace deactivation drives the SAME boundary hook the minimized host does
    h.slice.setOrkyPaneHidden('p1', true)
    h.slice.notifyOrkyRootChanged(A)
    h.slice.notifyOrkyRootChanged(A)
    h.slice.notifyOrkyRootChanged(A) // N ≥ 3 rapid notifications — no matter how busy the root is
    expect(h.registryDetail).toHaveBeenCalledTimes(1) // ZERO fetches while hidden
    expect(h.get().orkyPaneDetail.p1.stale).toBe(true)

    // workspace activation with suppressed staleness: exactly ONE fetch
    h.slice.setOrkyPaneHidden('p1', false)
    expect(h.registryDetail).toHaveBeenCalledTimes(2)
    expect(h.get().orkyPaneDetail.p1.stale).toBe(false)
    h.pending[1].resolve(okPayload(A))
    await flush()

    // activation of a background workspace whose pane received NO notification: ZERO fetches
    h.slice.setOrkyPaneHidden('p1', true)
    h.slice.setOrkyPaneHidden('p1', false)
    expect(h.registryDetail).toHaveBeenCalledTimes(2)
  })
})

describe('mid-flight hidden/unbound transitions gate the coalesced follow-up at SETTLE time (REQ-010 / FINDING-031)', () => {
  it('TEST-448 REQ-010 a pendingRefetch settling into a HIDDEN entry converts to stale:true and issues NOTHING (the T3 restore fetch then covers it); one settling into an unbound entry is dropped outright', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)          // in-flight
    h.slice.notifyOrkyRootChanged(A)          // displayed → queues the coalesced follow-up
    expect(h.get().orkyPaneDetail.p1.pendingRefetch).toBe(true)
    h.slice.setOrkyPaneHidden('p1', true)     // minimized / workspace-deactivated mid-flight
    h.pending[0].resolve(okPayload(A))
    await flush()
    // a hidden pane never fetches — not even via a follow-up queued while it was still displayed
    expect(h.registryDetail).toHaveBeenCalledTimes(1)
    const entry = h.get().orkyPaneDetail.p1
    expect(entry.stale).toBe(true)            // the suppressed follow-up becomes the stale mark
    expect(entry.pendingRefetch).toBe(false)
    // restore then owns the fetch: exactly once
    h.slice.setOrkyPaneHidden('p1', false)
    expect(h.registryDetail).toHaveBeenCalledTimes(2)

    // unbound at settle time: the follow-up is dropped outright
    const h2 = harness()
    h2.slice.fetchOrkyDetail('p1', A)
    h2.slice.notifyOrkyRootChanged(A)
    ;(h2.get().orkyPaneDetail.p1 as Entry).root = '' // membership loss unbinds mid-flight
    h2.pending[0].resolve(okPayload(A))
    await flush()
    expect(h2.registryDetail).toHaveBeenCalledTimes(1)
  })
})

describe('re-bind: exactly one fetch, and the PREVIOUS root\'s held payload is never renderable as the new root\'s (REQ-010 / FINDING-029)', () => {
  it('TEST-449 REQ-010 REQ-011 rebindOrkyPane clears the held detail (and error) whenever the new binding does not match it — before the new settle AND after a failed one, the pane can only render loading/the new root, never the old payload', async () => {
    const h = harness()
    h.slice.fetchOrkyDetail('p1', A)
    h.pending[0].resolve(okPayload(A))
    await flush()
    expect(h.get().orkyPaneDetail.p1.detail).toEqual(okPayload(A))

    // re-bind to C: exactly ONE new fetch (the re-bind IS the bind event)
    h.slice.rebindOrkyPane('w1', 'p1', C)
    expect(h.updatePaneConfig).toHaveBeenCalledWith('w1', 'p1', expect.objectContaining({ root: C }))
    expect(h.registryDetail).toHaveBeenCalledTimes(2)
    expect(h.registryDetail.mock.calls[1][0]).toBe(C)

    // BEFORE C settles: A's held payload must already be un-renderable as C's (DOM shows C's
    // loading, never A's rows stamped with C's identity — the FINDING-029 mislabel)
    const renderableAsCurrent = (e: Entry): boolean => {
      const d = e.detail as { ok?: boolean; root?: string } | null
      return d === null || (d.ok === true && typeof d.root === 'string' && sameProjectRoot(d.root, C, { caseFold: true }))
    }
    expect(renderableAsCurrent(h.get().orkyPaneDetail.p1 as Entry),
      're-bind must clear the previous root\'s held detail (or the held payload must match the new binding)').toBe(true)
    expect(h.get().orkyPaneDetail.p1.error).toBeNull()

    // a FAILED C fetch must not resurrect A's payload as the persistent render source
    h.pending[1].reject(new Error('C read failed'))
    await flush()
    const after = h.get().orkyPaneDetail.p1 as Entry
    expect(renderableAsCurrent(after),
      'after a failed post-re-bind fetch the pane renders C\'s error/loading — never the previous root\'s payload').toBe(true)
    expect(typeof after.error).toBe('string')
  })
})

describe('restore is a cross-host REMOUNT, not a fresh T1 bind (REQ-010 / FINDING-020)', () => {
  it('TEST-450 REQ-010 REQ-017 STRUCTURAL: OrkyPane\'s mount/bind effect consults the surviving orkyPaneDetail entry via getState() at event time (CONV-021) so a restore-remount does not double- or spuriously fetch on top of the T3 path', () => {
    const src = read('src/renderer/components/OrkyPane.tsx')
    // The amended REQ-010 pins the mechanism: "the surviving orkyPaneDetail entry identifies it at
    // mount time (entry present, binding sameProjectRoot-matching, hidden: true) — consult it via
    // getState() at event time (CONV-021)". A component whose mount effect fetches unconditionally
    // (the shipped defect: restore = 1 fetch where the matrix pins 0, stale restore = 2 where it
    // pins 1, re-bind = 2 where it pins 1) cannot contain this consultation.
    expect(src, 'the mount/bind effect must consult the surviving entry via getState() (REQ-010 T3 owns the hidden→displayed fetch decision)').toMatch(/getState\(\)/)
  })
})
