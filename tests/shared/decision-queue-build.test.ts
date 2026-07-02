// FROZEN unit suite — feature 0006-decision-queue-panel (phase 4).
// Pure queue build + count over the F5 `registry:status` aggregate (REQ-004 membership, REQ-005
// grouping/ordering, REQ-006 determinism, REQ-007 single count source, REQ-013 malformed tolerance).
// `src/shared/decision-queue.ts` is pure: no DOM, no Electron, no `../api`, no `process` reads —
// directly unit-testable in the node-env harness (03-plan.md "Testability constraint").
//
// AMENDED at the review→tests loopback (ESC-001 — sanctioned frozen-test touch, recorded in
// 04-tests.md "Review loopback"): TEST-373/374 deepen REQ-013's per-feature clause (FINDING-021 —
// the original TEST-312 pinned only entry-level garbage and a missing needsHuman), and the `feat()`
// fixture drops its TS2783-redundant explicit `feature:` assignment (FINDING-018 — the 0004 sibling
// fixture pattern; `...over`'s type already guarantees `feature` is present).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDecisionQueue, decisionQueueCount } from '@shared/decision-queue'
import { compareOrkyFeatures, selectChipFeature } from '@shared/orky-status'
import type { OrkyFeatureStatus, OrkyPaneStatus, OrkyRegistryEntry, OrkyRegistrySnapshot, OrkyRootSource } from '@shared/types'

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
function feat(over: Partial<OrkyFeatureStatus> & { feature: string }): OrkyFeatureStatus {
  // `feature` arrives solely via `...over` (whose type requires it) — no explicit pre-assignment,
  // so tsc can never prove a redundant overwrite (TS2783; FINDING-018, the 0004 fixture pattern).
  return {
    kind: 'needs-input', phase: 'implement', gateN: 4, gateM: 8,
    openBlocking: 0, needsHuman: true, failed: false, reason: 'escalation', lastActivityAt: 1000,
    detail: `${over.feature}: open escalation ESC-001 — needs you`, ...over
  }
}
const esc = (slug: string, over: Partial<OrkyFeatureStatus> = {}) =>
  feat({ feature: slug, needsHuman: true, reason: 'escalation', ...over })
const stalled = (slug: string, over: Partial<OrkyFeatureStatus> = {}) =>
  feat({ feature: slug, needsHuman: true, reason: 'stalled', detail: `${slug}: stalled 3m — no heartbeat`, ...over })
const hr = (slug: string, over: Partial<OrkyFeatureStatus> = {}) =>
  feat({ feature: slug, needsHuman: true, reason: 'human-review', detail: `${slug}: awaiting human-review (gates 7/8) — needs you`, ...over })
const busy = (slug: string) =>
  feat({ feature: slug, kind: 'busy', needsHuman: false, reason: null, detail: `${slug}: implement in progress` })
const doneOpen = (slug: string) =>
  feat({ feature: slug, kind: 'done', needsHuman: false, reason: null, phase: null, gateN: 8, openBlocking: 2, detail: `${slug}: pipeline complete` })

function status(features: OrkyFeatureStatus[]): OrkyPaneStatus {
  const chip = features[0] ?? null
  return {
    kind: chip?.kind ?? 'idle', label: chip ? `${chip.feature} · ${chip.phase} · ${chip.gateN}/${chip.gateM}` : '',
    needsHuman: chip?.needsHuman ?? false, failed: false, features, chipFeature: chip?.feature ?? null
  }
}
function entry(root: string, source: OrkyRootSource, features: OrkyFeatureStatus[] | null): OrkyRegistryEntry {
  return { root, source, status: features === null ? null : status(features) }
}
const pairs = (groups: ReturnType<typeof buildDecisionQueue>) =>
  groups.flatMap(g => g.items.map(i => `${i.projectRoot}::${i.featureSlug}`))

// Deterministic PRNG (mulberry32) for the shuffle test — no Math.random in the test either.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('buildDecisionQueue — membership (REQ-004)', () => {
  it('TEST-301 REQ-004 REQ-015 exactly the needsHuman features are items; busy/done/status-null contribute none; status objects are the fixture objects verbatim', () => {
    const e1 = esc('feat-a'), s1 = stalled('feat-b'), h1 = hr('feat-c')
    const snapshot: OrkyRegistrySnapshot = [
      // needsHuman prefix first (pinned upstream contiguous-prefix property), then non-needsHuman.
      entry('/proj/alpha', 'pane', [e1, s1, h1, busy('feat-busy'), doneOpen('feat-done')]),
      entry('/proj/beta', 'persisted', null)     // status:null → no items, no group
    ]
    const groups = buildDecisionQueue(snapshot)
    expect(groups).toHaveLength(1)
    expect(groups[0].projectRoot).toBe('/proj/alpha')
    expect(groups[0].items.map(i => i.featureSlug)).toEqual(['feat-a', 'feat-b', 'feat-c'])
    // Verbatim reuse (REQ-015 / D2): the carried OrkyFeatureStatus is the SAME object, not a re-projection.
    expect(groups[0].items[0].status).toBe(e1)
    expect(groups[0].items[1].status).toBe(s1)
    expect(groups[0].items[2].status).toBe(h1)
  })

  it('TEST-302 REQ-004 a persisted-only root with no open pane still contributes items (pane-independence); source is never filtered', () => {
    const snapshot: OrkyRegistrySnapshot = [
      entry('/proj/a', 'persisted', [esc('p-only')]),
      entry('/proj/b', 'both', [hr('b-feat')]),
      entry('/proj/c', 'pane', [stalled('c-feat')])
    ]
    const groups = buildDecisionQueue(snapshot)
    expect(pairs(groups).sort()).toEqual([
      '/proj/a::p-only', '/proj/b::b-feat', '/proj/c::c-feat'
    ].sort())
  })

  it('TEST-303 REQ-004 REQ-013 total over null/empty/all-quiet input: always [] and never a throw', () => {
    expect(buildDecisionQueue(null)).toEqual([])
    expect(buildDecisionQueue([])).toEqual([])
    // A valid snapshot whose members have no needsHuman feature yields zero groups (the empty state).
    const quiet: OrkyRegistrySnapshot = [
      entry('/proj/a', 'pane', [busy('running')]),
      entry('/proj/b', 'persisted', [doneOpen('finished')]),
      entry('/proj/c', 'pane', [])
    ]
    expect(buildDecisionQueue(quiet)).toEqual([])
  })
})

describe('buildDecisionQueue — grouping + deterministic ordering (REQ-005/REQ-006)', () => {
  it('TEST-304 REQ-005 groups carry projectName = basename of root (posix AND win32 spellings) and the verbatim full root', () => {
    const groups = buildDecisionQueue([
      entry('/home/kev/projA', 'pane', [esc('x')]),
      entry('C:\\dev\\Termhalla', 'pane', [esc('y')])
    ])
    const byRoot = new Map(groups.map(g => [g.projectRoot, g]))
    expect(byRoot.get('/home/kev/projA')?.projectName).toBe('projA')
    expect(byRoot.get('C:\\dev\\Termhalla')?.projectName).toBe('Termhalla')
    // The full path stays available verbatim (the hover/title text + the F8 identity).
    expect(byRoot.get('C:\\dev\\Termhalla')?.projectRoot).toBe('C:\\dev\\Termhalla')
  })

  it('TEST-305 REQ-005 groups order by their top item rank via the shared comparator (escalation before stalled before human-review)', () => {
    const groups = buildDecisionQueue([
      entry('/proj/a-stalled', 'pane', [stalled('s')]),
      entry('/proj/b-escalation', 'pane', [esc('e')]),
      entry('/proj/c-review', 'pane', [hr('h')])
    ])
    expect(groups.map(g => g.projectRoot)).toEqual([
      '/proj/b-escalation', '/proj/a-stalled', '/proj/c-review'
    ])
  })

  it('TEST-306 REQ-005 REQ-006 comparator-equal top items tie-break by root CODEPOINT order (never localeCompare)', () => {
    const same = () => esc('same-slug', { lastActivityAt: 42 })
    const groups = buildDecisionQueue([
      entry('/x/apple', 'pane', [same()]),
      entry('/x/Banana', 'pane', [same()])
    ])
    // Codepoint: 'B' (0x42) < 'a' (0x61) — a localeCompare sort would put apple first.
    expect(groups.map(g => g.projectRoot)).toEqual(['/x/Banana', '/x/apple'])
  })

  it('TEST-307 REQ-005 within a group the item order is the needsHuman prefix of status.features VERBATIM (no re-sort)', () => {
    // Deliberately NOT comparator order (human-review ranked before escalation): the builder must
    // preserve the upstream array order, not re-rank it.
    const groups = buildDecisionQueue([
      entry('/proj/a', 'pane', [hr('z-review'), esc('a-escalation'), busy('quiet')])
    ])
    expect(groups[0].items.map(i => i.featureSlug)).toEqual(['z-review', 'a-escalation'])
  })

  it('TEST-308 REQ-005 compareOrkyFeatures is the exported chip comparator (identity with selectChipFeature; single definition; imported, not copied)', () => {
    const fixtures: OrkyFeatureStatus[] = [
      hr('b', { lastActivityAt: 5 }), esc('a', { lastActivityAt: 1 }), stalled('c', { lastActivityAt: 9 }),
      busy('d'), esc('e', { lastActivityAt: 1 }), doneOpen('f'), stalled('g', { lastActivityAt: 9 })
    ]
    const rand = mulberry32(7)
    for (let i = 0; i < 25; i++) {
      const list = shuffled(fixtures, rand)
      // The exported comparator's total order picks exactly the chip selectChipFeature picks.
      expect([...list].sort(compareOrkyFeatures)[0]).toEqual(selectChipFeature(list))
    }
    // Pinned semantics of the export (needsHuman first, reason rank, newer activity, slug codepoint).
    expect(compareOrkyFeatures(esc('x'), stalled('y'))).toBeLessThan(0)
    expect(compareOrkyFeatures(stalled('x'), hr('y'))).toBeLessThan(0)
    expect(compareOrkyFeatures(busy('x'), hr('y'))).toBeGreaterThan(0)
    expect(compareOrkyFeatures(esc('x', { lastActivityAt: 2 }), esc('y', { lastActivityAt: 1 }))).toBeLessThan(0)
    // Single definition: orky-status.ts holds the ONE needsHuman-first comparison; the queue module
    // imports it rather than re-implementing it (REQ-005 "never copied or re-implemented").
    const orkyStatusSrc = readFileSync(resolve(process.cwd(), 'src/shared/orky-status.ts'), 'utf8')
    const dqSrc = readFileSync(resolve(process.cwd(), 'src/shared/decision-queue.ts'), 'utf8')
    expect(orkyStatusSrc.match(/needsHuman !== /g)?.length).toBe(1)
    expect(dqSrc).toMatch(/compareOrkyFeatures/)
    expect(dqSrc).toMatch(/from '(\.\/|@shared\/)orky-status'/)
    expect(dqSrc).not.toMatch(/needsHuman !== /)
  })

  it('TEST-309 REQ-006 identical aggregate in → identical order out: deep-equal snapshots and 100 shuffled entry orders produce ONE order', () => {
    const snapshot: OrkyRegistrySnapshot = [
      entry('/p/a', 'pane', [stalled('s1'), hr('h1')]),
      entry('/p/b', 'persisted', [esc('e1')]),
      entry('/p/c', 'both', [hr('h2'), hr('h3', { lastActivityAt: 1 })]),
      entry('/p/d', 'pane', [esc('e2', { lastActivityAt: 999 })])
    ]
    const baseline = pairs(buildDecisionQueue(snapshot))
    expect(baseline.length).toBe(6)
    // Deep-equal but non-identical object → byte-identical order (REQ-006 acceptance).
    expect(pairs(buildDecisionQueue(structuredClone(snapshot)))).toEqual(baseline)
    // Entry-order independence: 100 seeded shuffles of the entry array collapse to the same order.
    const rand = mulberry32(1234)
    for (let i = 0; i < 100; i++) {
      expect(pairs(buildDecisionQueue(shuffled(snapshot, rand)))).toEqual(baseline)
    }
  })

  it('TEST-310 REQ-006 the sort path is locale/clock/randomness-free (source assertion on decision-queue.ts)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/shared/decision-queue.ts'), 'utf8')
    expect(src).not.toMatch(/localeCompare/)
    expect(src).not.toMatch(/Date\.now/)
    expect(src).not.toMatch(/Math\.random/)
  })
})

describe('decisionQueueCount — the single count source (REQ-007)', () => {
  it('TEST-311 REQ-007 count = sum of items across groups; 0 for the empty build', () => {
    const groups = buildDecisionQueue([
      entry('/p/a', 'pane', [esc('e1'), stalled('s1')]),
      entry('/p/b', 'persisted', [hr('h1')])
    ])
    expect(decisionQueueCount(groups)).toBe(3)
    expect(decisionQueueCount(buildDecisionQueue([]))).toBe(0)
    expect(decisionQueueCount(buildDecisionQueue(null))).toBe(0)
  })
})

describe('buildDecisionQueue — per-entry / per-feature malformed tolerance (REQ-013 / CONV-002)', () => {
  it('TEST-312 REQ-013 garbage entries and mistyped features contribute nothing, throw nowhere, and never break well-formed siblings', () => {
    const good = entry('/p/good', 'pane', [esc('ok')])
    const garbage = [
      good,
      {},                                                        // no fields at all
      null,                                                      // non-object entry
      42,                                                        // non-object entry
      { root: 7, source: 'pane', status: status([esc('bad-root')]) },   // non-string root
      { root: '/p/badstatus', source: 'pane', status: 'nope' },         // non-object status
      { root: '/p/badfeatures', source: 'pane', status: { features: 'nope' } },  // non-array features
      entry('/p/mixed', 'pane', [{ feature: 'no-needs-human-field' } as never, esc('sibling-ok')])
    ] as unknown as OrkyRegistrySnapshot
    const groups = buildDecisionQueue(garbage)
    const got = pairs(groups)
    expect(got).toContain('/p/good::ok')
    // A feature missing/mistyping `needsHuman` contributes no item, but its well-formed sibling in
    // the SAME entry still renders. (The mixed fixture puts the malformed object first — the builder
    // must skip it without truncating the prefix scan or throwing.)
    expect(got).toContain('/p/mixed::sibling-ok')
    expect(got.some(p => p.includes('no-needs-human-field'))).toBe(false)
    expect(got.some(p => p.includes('bad-root'))).toBe(false)
    // Non-array snapshot → [] (the store never routes one here, but the function is total).
    expect(buildDecisionQueue({} as never)).toEqual([])
    expect(buildDecisionQueue('garbage' as never)).toEqual([])
  })
})

describe('buildDecisionQueue — mistyped CONSUMED fields on ADMITTED-shape features (REQ-013 — review loopback, FINDING-021)', () => {
  // Sanctioned tests-phase amendment (ESC-001): frozen TEST-312 pinned only entry-level garbage and
  // a missing needsHuman — a shallow pin of REQ-013's per-FEATURE clause. These vectors pin the
  // deep half: a record that PASSES the shallow membership check (needsHuman === true + non-empty
  // feature string) but MISTYPES any other consumed field (Verified contract: reason string|null,
  // phase string|null, gateN/gateM/openBlocking/lastActivityAt number, detail string) contributes
  // NO item and throws nowhere. Consequences pinned away: an object-typed reason/phase/detail would
  // crash the whole renderer as a React child, and a missing/non-number lastActivityAt drives
  // compareOrkyFeatures to NaN (undefined/string arithmetic), making Array.prototype.sort's order
  // implementation-defined (a NaN comparator result coerces to +0 — ES2023 CompareArrayElements).
  const admitted = (slug: string, over: Record<string, unknown>): OrkyFeatureStatus => {
    const f = feat({ feature: slug }) as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete f[k]
      else f[k] = v
    }
    return f as unknown as OrkyFeatureStatus
  }

  it('TEST-373 REQ-013 an admitted-shape feature mistyping a consumed field contributes NO item and throws nowhere; well-formed siblings survive', () => {
    const mistyped: OrkyFeatureStatus[] = [
      admitted('bad-reason', { reason: {} }),                          // object reason → React-child crash upstream
      admitted('bad-phase', { phase: {} }),                            // object phase
      admitted('bad-gate-n', { gateN: '4' }),                          // string gateN
      admitted('bad-detail', { detail: {} }),                          // object detail
      admitted('bad-last-activity', { lastActivityAt: 'yesterday' }),  // string lastActivityAt → NaN comparator
      admitted('no-last-activity', { lastActivityAt: undefined })      // MISSING lastActivityAt → NaN comparator
    ]
    const snapshot: OrkyRegistrySnapshot = [
      entry('/p/valid', 'pane', [esc('ok')]),
      entry('/p/mistyped', 'pane', [...mistyped, esc('sibling-ok')])
    ]
    let groups: ReturnType<typeof buildDecisionQueue> = []
    expect(() => { groups = buildDecisionQueue(snapshot) }).not.toThrow()
    const got = pairs(groups)
    expect(got).toContain('/p/valid::ok')
    // The well-formed sibling in the SAME entry still renders (CONV-002) …
    expect(got).toContain('/p/mistyped::sibling-ok')
    // … but every mistyped record is skipped — it must never become a queue item / React child.
    for (const slug of ['bad-reason', 'bad-phase', 'bad-gate-n', 'bad-detail', 'bad-last-activity', 'no-last-activity']) {
      expect(got.some(p => p.endsWith(`::${slug}`)), `${slug} must contribute no item`).toBe(false)
    }
  })

  it('TEST-374 REQ-013 REQ-006 REQ-005 group ordering stays well-defined with a mistyped-comparator-field sibling present (no NaN reaches compareOrkyFeatures)', () => {
    // Comparator-EQUAL valid tops in the apple/Banana groups force the REQ-005 root-codepoint
    // tie-break — while each group LEADS with a record whose admission would put NaN into the group
    // rank. REQ-013 mandates those records contribute no items, so the pinned observable is:
    // /x/Banana before /x/apple (codepoint — TEST-306's rule), stable across seeded shuffles.
    const same = () => esc('same-slug', { lastActivityAt: 42 })
    const snapshot: OrkyRegistrySnapshot = [
      entry('/x/apple', 'pane', [admitted('m1', { lastActivityAt: undefined }), same()]),
      entry('/x/Banana', 'pane', [admitted('m2', { lastActivityAt: 'yesterday' }), same()]),
      // An UNKNOWN reason string is the third NaN route (REASON_RANK lookup → undefined). The
      // Verified contract types reason as string|null, so its admission is not pinned either way —
      // but the ORDER must stay deterministic with it present, however the implementation treats it
      // (exclusion at admission, or a NaN-hardened group rank).
      entry('/x/cherry', 'pane', [admitted('m3', { reason: 'bogus-reason' }), esc('c-ok', { lastActivityAt: 41 })])
    ]
    const baseline = buildDecisionQueue(snapshot)
    // The codepoint tie-break survives the mistyped siblings (NaN would have degraded it to
    // insertion order: apple before Banana).
    expect(baseline.map(g => g.projectRoot).filter(r => r !== '/x/cherry')).toEqual(['/x/Banana', '/x/apple'])
    // The NaN-driving records never became items (REQ-013).
    expect(pairs(baseline).some(p => p.endsWith('::m1') || p.endsWith('::m2'))).toBe(false)
    expect(pairs(baseline)).toContain('/x/apple::same-slug')
    expect(pairs(baseline)).toContain('/x/Banana::same-slug')
    // Determinism (REQ-006): 100 seeded shuffles of the entry array collapse to ONE order — the
    // exact property an inconsistent (NaN-returning) comparator makes implementation-defined.
    const expected = pairs(baseline)
    const rand = mulberry32(4242)
    for (let i = 0; i < 100; i++) {
      expect(pairs(buildDecisionQueue(shuffled(snapshot, rand)))).toEqual(expected)
    }
  })
})
