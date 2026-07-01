// FROZEN unit suite — feature 0005-cross-project-orky-registry (phase 4 / pure-logic core, TASK-002).
// Targets `src/shared/orky-registry.ts` — the PURE membership-merge + deterministic-sort logic behind
// the cross-project aggregate (D2/D3, REQ-002/REQ-006/REQ-007). No fs/clock/IPC; total over malformed
// input; codepoint (NOT localeCompare) ordering so a re-read that does not change membership/status
// produces a byte-identical snapshot.
//
// Chosen contract (the plan's "Public interface" section is silent on the shared pure-logic shape; this
// suite freezes the simplest viable one per TASK-002 — the implementer MUST match it):
//
//   mergeRegistryMembership(paneRoots: ReadonlySet<string>, persistedRoots: readonly string[]):
//     Map<string, OrkyRootSource>
//   buildRegistrySnapshot(membership: ReadonlyMap<string, OrkyRootSource>,
//     statusByRoot: ReadonlyMap<string, OrkyPaneStatus | null>): OrkyRegistrySnapshot
//
// Runs RED today: `src/shared/orky-registry.ts` does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import { mergeRegistryMembership, buildRegistrySnapshot } from '@shared/orky-registry'
import type { OrkyPaneStatus, OrkyRegistryEntry } from '@shared/types'

const IDLE: OrkyPaneStatus = { kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null }
const BUSY = (label: string): OrkyPaneStatus => ({ kind: 'busy', label, needsHuman: false, failed: false, features: [], chipFeature: null })

describe('mergeRegistryMembership — union of pane roots ∪ persisted roots, deduped by resolved root (REQ-002)', () => {
  it('TEST-058 REQ-002 a root in BOTH sets maps to "both"; pane-only -> "pane"; persisted-only -> "persisted"', () => {
    const m = mergeRegistryMembership(new Set(['/proj/x', '/proj/y']), ['/proj/x', '/proj/z'])
    expect(m.get('/proj/x')).toBe('both')
    expect(m.get('/proj/y')).toBe('pane')
    expect(m.get('/proj/z')).toBe('persisted')
    expect(m.size).toBe(3) // exactly one entry per resolved root, never a duplicate
  })

  it('TEST-059 REQ-002 totally empty inputs -> an empty map, never throws', () => {
    expect(mergeRegistryMembership(new Set(), []).size).toBe(0)
    expect(() => mergeRegistryMembership(new Set(), [])).not.toThrow()
  })

  it('TEST-060 REQ-002 a root appearing twice in the persisted array (or via 2 panes resolving to the same root, already deduped by the caller\'s Set) still yields exactly one entry', () => {
    // The persisted list MAY arrive with a duplicate (e.g. a not-yet-normalized read) — the merge itself
    // must still dedupe by key (the registry/store layers ALSO dedupe on their own normalize step, but
    // this pure function must be defensive on its own, never producing two map entries for one key).
    const m = mergeRegistryMembership(new Set(), ['/proj/z', '/proj/z'])
    expect(m.size).toBe(1)
    expect(m.get('/proj/z')).toBe('persisted')
    // two different pane ids resolving to the SAME root collapse to one Set member before this call —
    // opening a second pane on root X must never produce a second X entry.
    const m2 = mergeRegistryMembership(new Set(['/proj/x']), [])
    expect(m2.size).toBe(1)
  })

  it('TEST-061 REQ-002 only-pane and only-persisted single-source roots never get the "both" tag', () => {
    const m = mergeRegistryMembership(new Set(['/only/pane']), ['/only/persisted'])
    expect(m.get('/only/pane')).toBe('pane')
    expect(m.get('/only/persisted')).toBe('persisted')
  })
})

describe('buildRegistrySnapshot — entry shape + deterministic codepoint ordering (REQ-006/REQ-007)', () => {
  it('TEST-062 REQ-006 every entry carries exactly { root, source, status }; status null when not yet read', () => {
    const membership = new Map([['/proj/a', 'pane' as const]])
    const snap = buildRegistrySnapshot(membership, new Map())
    expect(snap).toEqual([{ root: '/proj/a', source: 'pane', status: null }])
    expect(Object.keys(snap[0]).sort()).toEqual(['root', 'source', 'status'])
  })

  it('TEST-063 REQ-006 a present status flows through unchanged (the reused OrkyPaneStatus, no new wrapper fields)', () => {
    const membership = new Map([['/proj/a', 'persisted' as const]])
    const statusByRoot = new Map([['/proj/a', BUSY('auth · implement · 3/8')]])
    const snap = buildRegistrySnapshot(membership, statusByRoot)
    expect(snap[0].status).toEqual(BUSY('auth · implement · 3/8'))
  })

  it('TEST-064 REQ-007 sorts by root using the DEFAULT (codepoint) comparator, NOT localeCompare', () => {
    // Default Array.prototype.sort on strings is codepoint order: 'B' (66) < 'a' (97), so an
    // uppercase-leading root sorts BEFORE a lowercase one. localeCompare (case-insensitive, ICU
    // collation in most locales) would invert this — this test fails under a localeCompare-based sort.
    const membership = new Map([
      ['/proj/apple', 'pane' as const],
      ['/proj/Banana', 'pane' as const]
    ])
    const snap = buildRegistrySnapshot(membership, new Map())
    expect(snap.map(e => e.root)).toEqual(['/proj/Banana', '/proj/apple'])
  })

  it('TEST-065 REQ-007 the same membership+status set serializes identically regardless of insertion/Map order (shuffled order, same output)', () => {
    const entries: Array<[string, 'pane' | 'persisted' | 'both']> = [
      ['/proj/zeta', 'pane'], ['/proj/alpha', 'persisted'], ['/proj/mid', 'both']
    ]
    const statusByRoot = new Map<string, OrkyPaneStatus | null>([
      ['/proj/zeta', IDLE], ['/proj/alpha', null], ['/proj/mid', BUSY('x')]
    ])
    const forward = buildRegistrySnapshot(new Map(entries), statusByRoot)
    const shuffled = buildRegistrySnapshot(new Map([...entries].reverse()), statusByRoot)
    expect(forward).toEqual(shuffled)
    expect(forward.map(e => e.root)).toEqual(['/proj/alpha', '/proj/mid', '/proj/zeta'])
  })

  it('TEST-066 REQ-007 an empty membership set yields an empty snapshot array, never throws', () => {
    expect(buildRegistrySnapshot(new Map(), new Map())).toEqual([])
  })

  it('TEST-067 REQ-006/REQ-007 a realistic mixed-source, mixed-status set has exactly one entry per root, every field present, sorted', () => {
    const membership = new Map<string, 'pane' | 'persisted' | 'both'>([
      ['/repo/c-proj', 'both'], ['/repo/a-proj', 'persisted'], ['/repo/b-proj', 'pane']
    ])
    const statusByRoot = new Map<string, OrkyPaneStatus | null>([
      ['/repo/c-proj', BUSY('y')], ['/repo/a-proj', null], ['/repo/b-proj', IDLE]
    ])
    const snap: OrkyRegistryEntry[] = buildRegistrySnapshot(membership, statusByRoot)
    expect(snap).toEqual([
      { root: '/repo/a-proj', source: 'persisted', status: null },
      { root: '/repo/b-proj', source: 'pane', status: IDLE },
      { root: '/repo/c-proj', source: 'both', status: BUSY('y') }
    ])
  })
})
