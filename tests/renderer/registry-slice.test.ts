// FROZEN unit suite — feature 0006-decision-queue-panel (phase 4 / REQ-003/007/008/011/012/013/017).
// The registry store slice: the ONE ingestion chokepoint for the `registry:status` push and the
// `registryCurrent()` recovery pull. Generation-guarded arbitration (first valid snapshot wins, a
// late-settling stale pull is discarded — REQ-003/FINDING-004), deep-equal short-circuit (REQ-008),
// total malformed tolerance (REQ-013/CONV-002), memoized single-chain selectors (REQ-007/REQ-008),
// and session-scoped-only drawer state (REQ-001/REQ-017).
//
// No jsdom: the harness drives the slice as plain objects (03-plan.md "Testability constraint").
// REQ-008's "zero re-renders on a value-identical push" is pinned at its zustand-observable seam:
// the state REFERENCE does not change, so no subscribed component can re-render; the memoized
// selector result keeps its reference too ("buildDecisionQueue at most once per distinct snapshot
// reference" ⇔ reference-stable groups).
//
// Chosen contract (04-tests.md): src/renderer/store/registry-slice.ts exports
//   createRegistrySlice(deps: SliceDeps): Pick<State, 'setQueueOpen' | 'setRegistrySnapshot'
//     | 'applyRecoveryPull' | 'recoveryPullFailed' | 'queueGroups' | 'queueCount'>
// over state fields { registrySnapshot, registryError, queueOpen, snapshotGeneration }.
// Runs RED: neither registry-slice.ts nor @shared/decision-queue exists yet.
import { describe, it, expect, vi } from 'vitest'
import { createRegistrySlice } from '../../src/renderer/store/registry-slice'
import { buildDecisionQueue, decisionQueueCount } from '@shared/decision-queue'
import type { OrkyFeatureStatus, OrkyRegistryEntry, OrkyRegistrySnapshot } from '@shared/types'

function feat(slug: string, needsHuman = true): OrkyFeatureStatus {
  return {
    feature: slug, kind: needsHuman ? 'needs-input' : 'busy', phase: 'implement', gateN: 4, gateM: 8,
    openBlocking: 0, needsHuman, failed: false, reason: needsHuman ? 'escalation' : null,
    lastActivityAt: 10, detail: `${slug}: open escalation ESC-001 — needs you`
  }
}
function entry(root: string, slugs: string[]): OrkyRegistryEntry {
  const features = slugs.map(s => feat(s))
  return {
    root, source: 'pane',
    status: { kind: 'needs-input', label: '', needsHuman: features.length > 0, failed: false, features, chipFeature: features[0]?.feature ?? null }
  }
}
const snap = (...roots: [string, string[]][]): OrkyRegistrySnapshot => roots.map(([r, s]) => entry(r, s))

function harness() {
  let state: Record<string, unknown> = {
    registrySnapshot: null, registryError: null, queueOpen: false, snapshotGeneration: 0
  }
  const set = (patch: unknown) => {
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state as never
  const scheduleAutosave = vi.fn(), scheduleQuickSave = vi.fn(), scheduleNotesSave = vi.fn(), commitPane = vi.fn()
  const slice = createRegistrySlice({ set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane } as never)
  return { slice, get: () => state, scheduleAutosave, scheduleQuickSave, scheduleNotesSave }
}

describe('queueOpen — session-scoped drawer state (REQ-001/REQ-017)', () => {
  it('TEST-330 REQ-001 REQ-017 setQueueOpen toggles without ANY persistence side effect (mirrors setNotesOpen)', () => {
    const { slice, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave } = harness()
    expect(get().queueOpen).toBe(false)   // the drawer starts closed
    slice.setQueueOpen(true)
    expect(get().queueOpen).toBe(true)
    slice.setQueueOpen(false)
    expect(get().queueOpen).toBe(false)
    expect(scheduleQuickSave).not.toHaveBeenCalled()
    expect(scheduleAutosave).not.toHaveBeenCalled()
    expect(scheduleNotesSave).not.toHaveBeenCalled()
  })
})

describe('setRegistrySnapshot — the single ingestion chokepoint (REQ-003/REQ-008/REQ-013)', () => {
  it('TEST-331 REQ-003 a valid snapshot is applied: held, error-free, generation incremented', () => {
    const { slice, get } = harness()
    const s1 = snap(['/p/a', ['f1']])
    slice.setRegistrySnapshot(s1)
    expect(get().registrySnapshot).toEqual(s1)
    expect(get().registryError).toBeNull()
    expect(get().snapshotGeneration).toBe(1)
  })

  it('TEST-332 REQ-008 a deep-equal (but !==) push keeps the EXISTING state reference and still bumps the generation', () => {
    const { slice, get } = harness()
    slice.setRegistrySnapshot(snap(['/p/a', ['f1']], ['/p/b', ['f2']]))
    const held = get().registrySnapshot
    const genAfterFirst = get().snapshotGeneration as number
    // F5 emits a NEW array object on every recompute — reference equality never holds across pushes.
    slice.setRegistrySnapshot(structuredClone(held))
    expect(get().registrySnapshot).toBe(held)   // same reference → zero zustand re-renders
    // The guard tracks ORDER of application, not value change (03-plan.md TASK-005).
    expect(get().snapshotGeneration).toBe(genAfterFirst + 1)
  })

  it('TEST-333 REQ-008 a CHANGED snapshot replaces promptly (no over-memoization)', () => {
    const { slice, get } = harness()
    slice.setRegistrySnapshot(snap(['/p/a', ['f1', 'f2']]))
    const held = get().registrySnapshot
    const s2 = snap(['/p/a', ['f1']])   // one item dropped
    slice.setRegistrySnapshot(s2)
    expect(get().registrySnapshot).not.toBe(held)
    expect(get().registrySnapshot).toEqual(s2)
  })

  it('TEST-334 REQ-013 a malformed (non-array) payload with NO prior snapshot sets a SPECIFIC error and never throws', () => {
    for (const garbage of [undefined, 'nope', 42, { not: 'an array' }]) {
      const { slice, get } = harness()
      expect(() => slice.setRegistrySnapshot(garbage)).not.toThrow()
      expect(get().registrySnapshot).toBeNull()
      const err = get().registryError as string | null
      expect(typeof err).toBe('string')
      expect(err!.toLowerCase()).not.toBe('error')           // never a bare "error" (CONV-001)
      expect(err!).toMatch(/registry|orky/i)                  // names what is unavailable
      expect(err!).toMatch(/malformed|invalid|payload|unexpected/i)  // names what failed
    }
  })

  it('TEST-335 REQ-013 a malformed payload AFTER a valid snapshot is a no-op: stale-but-valid data keeps rendering, no error shown', () => {
    const { slice, get } = harness()
    slice.setRegistrySnapshot(snap(['/p/a', ['f1']]))
    const held = get().registrySnapshot
    slice.setRegistrySnapshot({ bogus: true })
    expect(get().registrySnapshot).toBe(held)
    expect(get().registryError).toBeNull()
  })

  it('TEST-336 REQ-013 a following valid snapshot clears the error state', () => {
    const { slice, get } = harness()
    slice.setRegistrySnapshot('garbage')
    expect(get().registryError).not.toBeNull()
    const s1 = snap(['/p/a', ['f1']])
    slice.setRegistrySnapshot(s1)
    expect(get().registryError).toBeNull()
    expect(get().registrySnapshot).toEqual(s1)
  })
})

describe('recovery-pull arbitration — generation guard (REQ-003/REQ-011 / FINDING-004)', () => {
  it('TEST-337 REQ-003 REQ-011 the pull applies when nothing else arrived; a STALE pull settling after a push is discarded', () => {
    // (a) push withheld, pull resolves first → the pull result is applied (missed-push recovery).
    {
      const { slice, get } = harness()
      const issuedAt = get().snapshotGeneration as number
      const pulled = snap(['/p/pull', ['f1']])
      slice.applyRecoveryPull(pulled, issuedAt)
      expect(get().registrySnapshot).toEqual(pulled)
      expect(get().registryError).toBeNull()
    }
    // (b) the pull was issued at generation g, a push applied afterwards → the late pull is DISCARDED:
    // the store stays on the pushed data (first valid snapshot wins; pushes are then the sole source).
    {
      const { slice, get } = harness()
      const issuedAt = get().snapshotGeneration as number   // pull issued BEFORE any snapshot
      const pushed = snap(['/p/pushed', ['fresh']])
      slice.setRegistrySnapshot(pushed)                      // push lands while the pull is in flight
      const held = get().registrySnapshot
      const genAfterPush = get().snapshotGeneration as number
      slice.applyRecoveryPull(snap(['/p/stale', ['old']]), issuedAt)
      expect(get().registrySnapshot).toBe(held)              // unchanged reference → no regression render
      expect(get().snapshotGeneration).toBe(genAfterPush)    // the discard applies nothing
      expect(get().registryError).toBeNull()
    }
  })

  it('TEST-338 REQ-011 REQ-013 a pull REJECTION errors only when no valid snapshot is held, with specific text; it never disturbs held data', () => {
    // No snapshot held → explicit error state naming the pull failure (never a bare "error").
    {
      const { slice, get } = harness()
      slice.recoveryPullFailed()
      const err = get().registryError as string | null
      expect(typeof err).toBe('string')
      expect(err!.toLowerCase()).not.toBe('error')
      expect(err!).toMatch(/registry|orky/i)
      expect(err!).toMatch(/unavailable|failed|could not|pull|current/i)
      expect(get().registrySnapshot).toBeNull()
    }
    // A valid snapshot held → the rejection is a no-op (stale-but-valid data keeps rendering, and the
    // loading state never resurrects because the snapshot stays non-null).
    {
      const { slice, get } = harness()
      const s1 = snap(['/p/a', ['f1']])
      slice.setRegistrySnapshot(s1)
      const held = get().registrySnapshot
      slice.recoveryPullFailed()
      expect(get().registrySnapshot).toBe(held)
      expect(get().registryError).toBeNull()
    }
  })
})

describe('memoized selectors — one selector, one number (REQ-007/REQ-008)', () => {
  it('TEST-339 REQ-007 REQ-008 queueGroups/queueCount are reference-stable per snapshot reference and derive through the ONE shared chain', () => {
    const { slice, get } = harness()
    slice.setRegistrySnapshot(snap(['/p/a', ['f1', 'f2']], ['/p/b', ['f3']]))
    const g1 = slice.queueGroups()
    const g2 = slice.queueGroups()
    expect(g2).toBe(g1)                                     // memoized: at most one build per snapshot ref
    expect(slice.queueCount()).toBe(3)
    // The count is decisionQueueCount over the SAME buildDecisionQueue result — never a second count.
    expect(slice.queueCount()).toBe(decisionQueueCount(g1))
    expect(g1).toEqual(buildDecisionQueue(get().registrySnapshot as OrkyRegistrySnapshot))
    // A deep-equal push short-circuits → the derived groups keep their reference (nothing re-derives).
    slice.setRegistrySnapshot(structuredClone(get().registrySnapshot))
    expect(slice.queueGroups()).toBe(g1)
    // A CHANGED push re-derives: badge and list move together (3 → 2).
    slice.setRegistrySnapshot(snap(['/p/a', ['f1', 'f2']]))
    const g3 = slice.queueGroups()
    expect(g3).not.toBe(g1)
    expect(slice.queueCount()).toBe(2)
    expect(decisionQueueCount(g3)).toBe(2)
  })

  it('TEST-340 REQ-011 REQ-012 the slice-level state matrix: loading, empty, and error are mutually exclusive; push-first ≡ pull-first', () => {
    type S = { registrySnapshot: unknown; registryError: unknown }
    const phase = (s: S) =>
      s.registrySnapshot === null && s.registryError === null ? 'loading'
        : s.registrySnapshot === null ? 'error' : 'held'
    // Loading: neither the push nor the pull has produced anything, and no error is shown.
    const a = harness()
    expect(phase(a.get() as S)).toBe('loading')
    expect(a.slice.queueCount()).toBe(0)                    // the badge shows no number while loading
    // Pull-first with []: loading → empty (valid snapshot, zero items).
    a.slice.applyRecoveryPull([], 0)
    expect(phase(a.get() as S)).toBe('held')
    expect(a.slice.queueGroups()).toEqual([])
    expect(a.slice.queueCount()).toBe(0)
    // Push-first transitions equivalently: the end state is deep-equal regardless of the source.
    const b = harness()
    b.slice.setRegistrySnapshot([])
    expect(b.get().registrySnapshot).toEqual(a.get().registrySnapshot)
    expect(b.get().registryError).toBe(a.get().registryError)
    // Error: only reachable with NO valid snapshot; a valid snapshot afterwards clears it and the
    // loading state never reappears once a snapshot exists.
    const c = harness()
    c.slice.recoveryPullFailed()
    expect(phase(c.get() as S)).toBe('error')
    c.slice.setRegistrySnapshot(snap(['/p/a', ['f1']]))
    expect(phase(c.get() as S)).toBe('held')
    c.slice.recoveryPullFailed()                            // late rejection after data → still held
    expect(phase(c.get() as S)).toBe('held')
  })
})
