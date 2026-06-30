// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / pure-logic core).
// REVISED at the review LOOP-BACK (spec amended to 29 REQs, ESC-001): the detection model is now
// GATE-BASED (full roll-up), not keyed on the lagging `state.json.phase`. The mapper signatures gained
// an `activePhase` argument (the active feature's `active.json.phase`); `gateFrontier`,
// `ORKY_AUTONOMOUS_PHASES`, and `parseOrkyTimestamp` are new exports. See 04-tests.md for the catalogue.
//
// Every mapper is total (never throws on empty/malformed input) and pure (no Date.now / no I/O):
// `now`, `thresholdMs`, and `activePhase` are ALWAYS injected, so there is ZERO wall-clock or timezone
// dependence here. The live phase is NEVER derived from the lagging `state.json.phase` inside a mapper.
//
// Runs RED against the prior-pass (old `state.json.phase`) implementation: the new 7-arg
// `orkyFeatureStatus` / 6-arg `isStalled` positional contracts, the gate-based needs-human shape, the
// clean-done popover exclusion, and the new `gateFrontier`/`parseOrkyTimestamp` exports all disagree
// with the shipped code — exactly the want-of-correction signal.
import { describe, it, expect } from 'vitest'
import {
  ORKY_PHASES,
  ORKY_AUTONOMOUS_PHASES,
  gateN,
  gateFrontier,
  parseOrkyTimestamp,
  openBlockingCount,
  isStalled,
  orkyFeatureStatus,
  selectChipFeature,
  orkyPaneStatus,
  normalizeFindings,
  normalizeFeatureRaw
} from '@shared/orky-status'
import { SCHEMA_VERSION } from '@shared/types'

// A fixed, injected clock — no test reads the wall clock (REQ-003 / REQ-021 / REQ-028 determinism anchor).
const NOW = 1_700_000_000_000

// Build an on-disk-shaped raw feature (mirrors state.json). `feature` is the slug, `phase` the lagging
// state.json phase (which the gate-based model treats as a last-resort fallback ONLY), `gates` a map of
// phase -> { passed, at }, `escalations` the escalation list.
type RawGate = { passed?: boolean; at?: string }
function raw(o: Partial<{
  feature: string
  phase: string
  gates: Record<string, RawGate>
  escalations: Array<{ id: string; status?: string; reason?: string }>
}> = {}): never {
  return { feature: 'auth', phase: 'implement', gates: {}, escalations: [], ...o } as never
}

// Build an OrkyFeatureStatus (the mapped, wire-shaped per-feature status the selector ranks).
function feat(o: Partial<{
  feature: string
  kind: string
  phase: string
  gateN: number
  gateM: number
  openBlocking: number
  needsHuman: boolean
  failed: boolean
  reason: 'escalation' | 'stalled' | 'human-review' | null
  lastActivityAt: number
  detail: string
}> = {}): never {
  return {
    feature: 'x', kind: 'idle', phase: 'spec', gateN: 0, gateM: 8, openBlocking: 0,
    needsHuman: false, failed: false, reason: null, lastActivityAt: 0, detail: '', ...o
  } as never
}

const allPassed = (): Record<string, RawGate> => Object.fromEntries(ORKY_PHASES.map(p => [p, { passed: true }]))
// Gates passed for every canonical phase up to AND INCLUDING `phase` (the real on-disk topology).
function gatesThrough(phase: string): Record<string, RawGate> {
  const idx = ORKY_PHASES.indexOf(phase as never)
  return Object.fromEntries(ORKY_PHASES.slice(0, idx + 1).map(p => [p, { passed: true }]))
}
// The REAL "awaiting human-review" shape: every AUTONOMOUS gate (through doc-sync) passed, human-review
// gate absent. The real pipeline leaves state.json.phase at 'doc-sync' here — it never says 'human-review'.
const awaitingHumanGates = (): Record<string, RawGate> =>
  Object.fromEntries(ORKY_AUTONOMOUS_PHASES.map(p => [p, { passed: true }]))

describe('ORKY_PHASES + ORKY_AUTONOMOUS_PHASES + gate N/M (REQ-001)', () => {
  it('TEST-001 REQ-001 defines the canonical 8-phase order with human-review counting toward M', () => {
    expect(ORKY_PHASES).toEqual(
      ['brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync', 'human-review']
    )
    expect(ORKY_PHASES.length).toBe(8)                              // gateM
    expect(ORKY_PHASES[ORKY_PHASES.length - 1]).toBe('human-review') // a real, final gate
  })

  it('TEST-002 REQ-001 gateN counts only passed canonical phases; unknown keys ignored; total', () => {
    expect(gateN({ brainstorm: { passed: true }, spec: { passed: true }, plan: { passed: false }, bogus: { passed: true } } as never)).toBe(2)
    expect(gateN({} as never)).toBe(0)
    expect(gateN(undefined as never)).toBe(0)        // missing gates → 0, never throws
    expect(gateN(allPassed() as never)).toBe(8)      // all gates passed → 8/8
  })

  it('TEST-043 REQ-001/REQ-005 ORKY_AUTONOMOUS_PHASES = the 7 gates through doc-sync (ORKY_PHASES minus human-review)', () => {
    expect(ORKY_AUTONOMOUS_PHASES).toEqual(
      ['brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync']
    )
    expect(ORKY_AUTONOMOUS_PHASES.length).toBe(7)
    expect(ORKY_AUTONOMOUS_PHASES).not.toContain('human-review') // human-review is NOT autonomous (it is the human gate)
  })
})

describe('gateFrontier — live phase for a non-active feature (REQ-023)', () => {
  it('TEST-039 REQ-023 frontier is the phase AFTER the highest passed canonical gate; total, never throws', () => {
    expect(gateFrontier(gatesThrough('implement') as never)).toBe('review') // through implement → review
    expect(gateFrontier({} as never)).toBe('brainstorm')                      // none passed → brainstorm
    expect(gateFrontier(allPassed() as never)).toBeNull()                     // all 8 passed → complete (null)
    expect(gateFrontier(gatesThrough('brainstorm') as never)).toBe('spec')    // only brainstorm → spec
    expect(gateFrontier(undefined as never)).toBe('brainstorm')               // malformed → brainstorm, no throw
    // "highest" passed gate wins even when gates are non-contiguous (brainstorm + plan passed, spec not):
    expect(gateFrontier({ brainstorm: { passed: true }, plan: { passed: true } } as never)).toBe('tests')
  })
})

describe('parseOrkyTimestamp — timezone-safe (REQ-028)', () => {
  it('TEST-042 REQ-028 a tz-less ISO timestamp is interpreted as UTC, never local; offsets honored; garbage → null', () => {
    // tz-less → UTC (NOT the machine local zone). Compared against Date.UTC, which is absolute/TZ-independent,
    // so this pins the same epoch ms on any machine regardless of process.env.TZ (FINDING-DET-001).
    expect(parseOrkyTimestamp('2026-06-30T12:04:00')).toBe(Date.UTC(2026, 5, 30, 12, 4, 0))
    expect(parseOrkyTimestamp('2026-06-30T12:04:00Z')).toBe(Date.UTC(2026, 5, 30, 12, 4, 0))           // explicit Z unchanged
    expect(parseOrkyTimestamp('2026-06-30T12:04:00.000Z')).toBe(Date.UTC(2026, 5, 30, 12, 4, 0))
    expect(parseOrkyTimestamp('2026-06-30T12:04:00+02:00')).toBe(Date.UTC(2026, 5, 30, 10, 4, 0))       // +02:00 offset honored
    expect(parseOrkyTimestamp('not a date')).toBeNull()
    expect(parseOrkyTimestamp(undefined as never)).toBeNull()
    expect(parseOrkyTimestamp(null as never)).toBeNull()
  })
})

describe('openBlockingCount (REQ-002)', () => {
  it('TEST-003 REQ-002 counts open findings that are CRITICAL/HIGH OR contract_violation', () => {
    expect(openBlockingCount([
      { status: 'open', severity: 'HIGH' },
      { status: 'open', severity: 'LOW' },
      { status: 'open', severity: 'LOW', contract_violation: true },
      { status: 'resolved', severity: 'CRITICAL' },
      { status: 'open', severity: 'MEDIUM' }
    ] as never)).toBe(2)
  })

  it('TEST-004 REQ-002/REQ-019 is total, includes MEDIUM-but-contract_violation, never silently caps', () => {
    expect(openBlockingCount([])).toBe(0)
    expect(openBlockingCount(undefined as never)).toBe(0)
    expect(openBlockingCount(null as never)).toBe(0)
    expect(openBlockingCount('garbage' as never)).toBe(0)
    expect(openBlockingCount([{}] as never)).toBe(0)
    expect(openBlockingCount([{ status: 'open', severity: 'CRITICAL' }] as never)).toBe(1)
    expect(openBlockingCount([{ status: 'open', severity: 'MEDIUM', contract_violation: true }] as never)).toBe(1)
    expect(openBlockingCount([{ status: 'deferred', severity: 'HIGH' }, { status: 'acknowledged', severity: 'CRITICAL' }] as never)).toBe(0)
    expect(openBlockingCount([{ severity: 'HIGH' }] as never)).toBe(0)
    expect(openBlockingCount(Array.from({ length: 5 }, () => ({ status: 'open', severity: 'HIGH' })) as never)).toBe(5)
  })
})

describe('isStalled — finished-wins, active-only, off the LIVE phase, 120s boundary (REQ-003/REQ-023)', () => {
  // executing: an in-flight phase with no gate entry yet.
  const exec = raw({ feature: 'auth', phase: 'implement', gates: {} })

  it('TEST-005 REQ-003 stalls strictly above the injected threshold off the LIVE phase; the boundary is not stalled', () => {
    // Signature: isStalled(activeSlug, feature, activePhase, lastTickAt, now, thresholdMs).
    expect(isStalled('auth', exec, 'implement', NOW - 121_000, NOW, 120_000)).toBe(true)
    expect(isStalled('auth', exec, 'implement', NOW - 119_000, NOW, 120_000)).toBe(false)
    expect(isStalled('auth', exec, 'implement', NOW - 120_000, NOW, 120_000)).toBe(false) // exactly 120s → NOT stalled (strict >)

    // LIVE-PHASE DIVERGENCE (FINDING-DA-002): state.json.phase lags at 'implement' (implement gate
    // PASSED) but active.json.phase==='review' (review gate pending). Stall must key on the LIVE phase
    // (review, still executing) — the prior code read executing-ness off state.json.phase and could
    // never stall after the implement gate passed.
    const diverged = raw({ feature: 'auth', phase: 'implement', gates: gatesThrough('implement') })
    expect(isStalled('auth', diverged, 'review', NOW - 121_000, NOW, 120_000)).toBe(true)
  })

  it('TEST-006 REQ-003 finished-wins, non-active never stalls, null tick is false (total)', () => {
    const finished = raw({ feature: 'auth', phase: 'doc-sync', gates: allPassed() }) // human-review gate passed → complete
    expect(isStalled('auth', finished, 'human-review', NOW - 10_000_000, NOW, 120_000)).toBe(false) // finished wins over an ancient tick
    expect(isStalled('other', exec, null, NOW - 121_000, NOW, 120_000)).toBe(false)                  // a non-active feature has no live heartbeat
    expect(isStalled('auth', exec, 'implement', null, NOW, 120_000)).toBe(false)                     // missing tick → false, no throw
  })
})

describe('orkyFeatureStatus — per-feature map, gate-based, live-phase aware (REQ-004/005/006/023)', () => {
  it('TEST-007 REQ-004/REQ-023 an active mid-execution feature maps to busy; the LIVE phase wins over state.json.phase', () => {
    const r = raw({ feature: 'auth', phase: 'implement', gates: gatesThrough('tests') })
    const st = orkyFeatureStatus(r, [], true, 'implement', NOW - 1_000, NOW, 120_000)
    expect(st.kind).toBe('busy')
    expect(st.needsHuman).toBe(false)
    expect(st.gateN).toBe(4)
    expect(st.gateM).toBe(8)

    // Divergence: state.json.phase lags at 'implement' but active.json.phase==='review' → the reported
    // phase is the LIVE phase 'review' (not the lagging 'implement'), and it is busy in review.
    const d = raw({ feature: 'auth', phase: 'implement', gates: gatesThrough('implement') })
    const sd = orkyFeatureStatus(d, [], true, 'review', NOW - 1_000, NOW, 120_000)
    expect(sd.phase).toBe('review')
    expect(sd.kind).toBe('busy')
  })

  it('TEST-008 REQ-004/REQ-005 the REAL awaiting-human shape (gates through doc-sync, NO human-review gate) → needs-input/needsHuman', () => {
    // The real on-disk shape: state.json.phase is STILL 'doc-sync' here; human-review is recorded only
    // as an external gate, which is absent while awaiting. Gate-based detection works for ANY feature.
    const awaiting = raw({ feature: 'auth', phase: 'doc-sync', gates: awaitingHumanGates() })
    const st = orkyFeatureStatus(awaiting, [], false, null, null, NOW, 120_000) // non-active: gate-based still fires
    expect(st.kind).toBe('needs-input')
    expect(st.needsHuman).toBe(true)
    expect(st.reason).toBe('human-review')
    expect(st.detail.toLowerCase()).toContain('auth')
    expect(st.detail.toLowerCase()).toContain('human-review')
  })

  it('TEST-009 REQ-004 a feature whose human-review gate has passed maps to done (state.json.phase still doc-sync)', () => {
    const r = raw({ feature: 'auth', phase: 'doc-sync', gates: allPassed() })
    const st = orkyFeatureStatus(r, [], false, null, null, NOW, 120_000)
    expect(st.kind).toBe('done')
    expect(st.needsHuman).toBe(false)
  })

  it('TEST-010 REQ-005 needsHuman = open-escalation OR stalled OR awaiting-human; a quiet feature is false', () => {
    // (a) an open escalation mid-execution → needs-human, reason escalation
    const esc = raw({ feature: 'auth', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-3', status: 'open', reason: 'judgment call' }] })
    const s1 = orkyFeatureStatus(esc, [], true, 'implement', NOW - 1_000, NOW, 120_000)
    expect(s1.needsHuman).toBe(true)
    expect(s1.reason).toBe('escalation')

    // (b) a stalled active feature → needs-human, reason stalled
    const s2 = orkyFeatureStatus(raw({ feature: 'auth', phase: 'implement', gates: {} }), [], true, 'implement', NOW - 200_000, NOW, 120_000)
    expect(s2.needsHuman).toBe(true)
    expect(s2.reason).toBe('stalled')

    // (c) an idle feature between two passed gates, no escalation, not active/stalled → NOT needs-human
    const idle = raw({ feature: 'auth', phase: 'plan', gates: gatesThrough('plan') })
    expect(orkyFeatureStatus(idle, [], false, null, null, NOW, 120_000).needsHuman).toBe(false)

    // (d) a RESOLVED escalation must not trigger needs-human (only status==='open' counts)
    const resolved = raw({ feature: 'auth', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-1', status: 'resolved' }] })
    expect(orkyFeatureStatus(resolved, [], true, 'implement', NOW - 1_000, NOW, 120_000).needsHuman).toBe(false)
  })

  it('TEST-011 REQ-006 a gate FAILURE sets `failed` independently and does NOT, by itself, set needs-human', () => {
    // The current phase has an explicit gate entry that did not pass (the gate ran and halted).
    const failed = raw({ feature: 'auth', phase: 'review', gates: { ...gatesThrough('implement'), review: { passed: false } } })
    const sf = orkyFeatureStatus(failed, [], false, null, null, NOW, 120_000)
    expect(sf.failed).toBe(true)
    expect(sf.needsHuman).toBe(false) // surfaces as a RENDERED failure treatment (REQ-006), not as needs-input
    // a clean feature is not failed
    expect(orkyFeatureStatus(raw({ feature: 'auth', phase: 'implement', gates: gatesThrough('brainstorm') }), [], true, 'implement', NOW - 1_000, NOW, 120_000).failed).toBe(false)
  })

  it('TEST-040 REQ-023/REQ-004 a NON-active feature resolves its live phase from the gate frontier, never the lagging state.json.phase', () => {
    // state.json.phase LAGS at 'implement' but gates run through implement → frontier is 'review'.
    const r = raw({ feature: 'auth', phase: 'implement', gates: gatesThrough('implement') })
    const st = orkyFeatureStatus(r, [], false, null, null, NOW, 120_000)
    expect(st.phase).toBe('review') // the gate FRONTIER, not the lagging 'implement'
    expect(st.kind).toBe('idle')    // a non-active feature is never busy (no per-project heartbeat)
  })

  it('TEST-041 REQ-004 a NON-active feature is never busy and sources lastActivityAt from its own gate timestamps (tz-safe)', () => {
    // FINDING-DA-005: a non-active feature with an in-flight (gate-undefined) phase must be idle, not busy.
    const inflight = raw({ feature: 'zzz', phase: 'implement', gates: { brainstorm: { passed: true } } })
    expect(orkyFeatureStatus(inflight, [], false, null, null, NOW, 120_000).kind).toBe('idle')

    // FINDING-DA-004: lastActivityAt is the max of the feature's own gates[*].at (tz-safe, REQ-028), so
    // the REQ-007 recency tiebreak orders non-active features instead of collapsing them all to 0.
    const dated = raw({ feature: 'auth', phase: 'plan', gates: {
      brainstorm: { passed: true, at: '2026-01-01T00:00:00' },
      spec: { passed: true, at: '2026-01-03T00:00:00' }, // the max
      plan: { passed: true, at: '2026-01-02T00:00:00' }
    } })
    const st = orkyFeatureStatus(dated, [], false, null, null, NOW, 120_000)
    expect(st.lastActivityAt).toBe(parseOrkyTimestamp('2026-01-03T00:00:00'))
  })

  it('TEST-012 REQ-004 the detail string is specific + actionable (CONV-001), never a bare "needs input"', () => {
    const esc = raw({ feature: 'auth-feature', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-3', status: 'open', reason: 'design choice' }] })
    const d = orkyFeatureStatus(esc, [], true, 'implement', NOW - 1_000, NOW, 120_000).detail
    expect(d).not.toBe('needs input')
    expect(d.toLowerCase()).toContain('auth-feature') // names the feature
    expect(d).toContain('ESC-3')                        // names the reason (the open escalation id)
  })
})

describe('selectChipFeature — deterministic most-needs-you selector (REQ-007)', () => {
  it('TEST-013 REQ-007 escalation outranks human-review and the winner is order-independent', () => {
    const A = feat({ feature: 'A', needsHuman: true, reason: 'human-review', lastActivityAt: 10 })
    const B = feat({ feature: 'B', needsHuman: true, reason: 'escalation', lastActivityAt: 5 })
    const C = feat({ feature: 'C', needsHuman: false, reason: null, lastActivityAt: 20 })
    for (const perm of [[A, B, C], [C, B, A], [B, A, C], [A, C, B], [C, A, B], [B, C, A]]) {
      expect(selectChipFeature(perm as never)!.feature).toBe('B') // escalation beats human-review despite older activity
    }
  })

  it('TEST-014 REQ-007 ranks needsHuman-first, then activity, then feature-id as a stable final tiebreak', () => {
    const needs = feat({ feature: 'n', needsHuman: true, reason: 'stalled', lastActivityAt: 1 })
    const idle = feat({ feature: 'i', needsHuman: false, reason: null, lastActivityAt: 999 })
    expect(selectChipFeature([idle, needs] as never)!.feature).toBe('n')
    const old = feat({ feature: 'old', needsHuman: true, reason: 'escalation', lastActivityAt: 1 })
    const fresh = feat({ feature: 'fresh', needsHuman: true, reason: 'escalation', lastActivityAt: 9 })
    expect(selectChipFeature([old, fresh] as never)!.feature).toBe('fresh')
    const zeta = feat({ feature: 'zeta', needsHuman: true, reason: 'escalation', lastActivityAt: 5 })
    const alpha = feat({ feature: 'alpha', needsHuman: true, reason: 'escalation', lastActivityAt: 5 })
    expect(selectChipFeature([zeta, alpha] as never)!.feature).toBe('alpha')
    expect(selectChipFeature([alpha, zeta] as never)!.feature).toBe('alpha')
  })

  it('TEST-015 REQ-007 empty input returns null', () => {
    expect(selectChipFeature([])).toBeNull()
  })
})

describe('orkyPaneStatus — roll-up, chip label, clean-done exclusion, determinism (REQ-008/020/021)', () => {
  it('TEST-016 REQ-008 renders `feature · phase · gate N/M · ●k open`, omitting the count only at k=0', () => {
    const f = feat({ feature: 'auth', kind: 'busy', phase: 'implement', gateN: 5, gateM: 8, openBlocking: 2, lastActivityAt: 1 })
    expect(orkyPaneStatus([f] as never).label).toBe('auth · implement · 5/8 · ●2 open')
    const f0 = feat({ feature: 'auth', kind: 'busy', phase: 'implement', gateN: 5, gateM: 8, openBlocking: 0, lastActivityAt: 1 })
    expect(orkyPaneStatus([f0] as never).label).toBe('auth · implement · 5/8') // ●0 segment omitted, never a wrong number
  })

  it('TEST-017 REQ-021 is pure + order-independent with a defined empty shape', () => {
    expect(orkyPaneStatus([])).toEqual({ kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null })
    const fs = [
      feat({ feature: 'a', kind: 'busy', lastActivityAt: 1 }),
      feat({ feature: 'b', kind: 'needs-input', needsHuman: true, reason: 'escalation', lastActivityAt: 2 })
    ]
    const r1 = orkyPaneStatus(fs as never)
    const r2 = orkyPaneStatus([...fs].reverse() as never)
    expect(r1).toEqual(r2)                          // independent of input ordering
    expect(orkyPaneStatus(fs as never)).toEqual(r1) // identical inputs → identical output
    expect(() => orkyPaneStatus(undefined as never)).not.toThrow() // total
  })

  it('TEST-018 REQ-020 the popover lists busy / needs-input / failed / done-WITH-open; clean-done AND idle are EXCLUDED, ranked', () => {
    const a = feat({ feature: 'a', kind: 'idle', needsHuman: false, lastActivityAt: 9 })                 // idle → excluded
    const b = feat({ feature: 'b', kind: 'busy', needsHuman: false, lastActivityAt: 4 })                 // busy → kept
    const c = feat({ feature: 'c', kind: 'needs-input', needsHuman: true, reason: 'escalation', lastActivityAt: 1 }) // needs-input → kept (ranked first)
    const dClean = feat({ feature: 'd', kind: 'done', openBlocking: 0, lastActivityAt: 8 })              // CLEAN done → EXCLUDED
    const eOpen = feat({ feature: 'e', kind: 'done', openBlocking: 2, lastActivityAt: 3 })               // done WITH open items → kept
    const fFailed = feat({ feature: 'f', kind: 'idle', failed: true, lastActivityAt: 2 })                // failed-but-idle → kept
    const out = orkyPaneStatus([a, b, c, dClean, eOpen, fFailed] as never)
    // needs-human 'c' first; the rest are equal-needsHuman → ranked by newer activity then id: b(4) e(3) f(2).
    expect(out.features.map((x: { feature: string }) => x.feature)).toEqual(['c', 'b', 'e', 'f'])
    expect(out.chipFeature).toBe('c')

    // Direct clean-done exclusion: two done features, only the one WITH open blocking items is listed.
    const doneOpen = feat({ feature: 'd1', kind: 'done', openBlocking: 2, lastActivityAt: 5 })
    const doneClean = feat({ feature: 'd2', kind: 'done', openBlocking: 0, lastActivityAt: 6 })
    const dd = orkyPaneStatus([doneOpen, doneClean] as never)
    expect(dd.features.map((x: { feature: string }) => x.feature)).toEqual(['d1'])
    // FINDING-DA-007 (chip/popover consistency): selectChipFeature ranks over the FULL list and would
    // pick the clean-done 'd2' (newer activity) — but inPopover EXCLUDES clean-done, so the chip would
    // name a feature its own popover omits. The chip MUST be either null or a feature the popover lists.
    expect(dd.chipFeature === null || dd.features.some((x: { feature: string }) => x.feature === dd.chipFeature)).toBe(true)
  })
})

describe('orkyPaneStatus — clean-DONE chip: no `null` label, chip/popover consistency (FINDING-DA-007, REQ-008/020/023)', () => {
  // The steady state of THIS repo once 0004 merges: every feature clean-done — every gate (incl.
  // human-review) passed, ZERO open blocking findings. Built through orkyFeatureStatus so the on-disk
  // reality is pinned: a non-active done feature's LIVE phase is gateFrontier(allPassed) === null.
  const cleanDone = (slug: string) =>
    orkyFeatureStatus(raw({ feature: slug, phase: 'doc-sync', gates: allPassed() }), [], false, null, null, NOW, 120_000)

  it('TEST-056 REQ-008/REQ-023 a clean-done feature has a null live phase, yet its chip label MUST NOT render the literal string "null"', () => {
    const d1 = cleanDone('0002-panes')
    const d2 = cleanDone('0003-minimize')
    // sanity: these are exactly the clean-done shape the defect targets (done, null live phase, 0 open).
    expect(d1.kind).toBe('done')
    expect(d1.phase).toBeNull()       // gateFrontier(allPassed) === null — the source of the bad label
    expect(d1.openBlocking).toBe(0)

    const out = orkyPaneStatus([d1, d2] as never)
    // (1) FINDING-DA-007 defect 1: chipLabel/OrkyFeatureRow do NOT guard the null phase, so the chip
    // currently reads "<slug> · null · 8/8". The user-facing label MUST NOT leak the literal "null".
    expect(out.label).not.toContain('null')
    // If a chip IS rendered (the fix guards the null phase rather than clearing the chip), the actionable
    // gate fraction MUST survive — the label is `feature · <done-token> · 8/8`, never a `null` segment.
    if (out.chipFeature !== null) expect(out.label).toContain('8/8')
  })

  it('TEST-057 REQ-020/REQ-007 an all-clean-done project keeps chip and popover consistent (chip is null OR a feature the popover lists)', () => {
    const d1 = cleanDone('0002-panes')
    const d2 = cleanDone('0003-minimize')
    const out = orkyPaneStatus([d1, d2] as never)
    // FINDING-DA-007 defect 2: selectChipFeature ranks over the FULL list (incl. clean-done), but the
    // popover's inPopover EXCLUDES clean-done — so the chip currently names '0002-panes' while .features
    // is []. Post-fix the roll-up MUST either show no chip, or a chip the popover actually lists.
    expect(out.chipFeature === null || out.features.some((x: { feature: string }) => x.feature === out.chipFeature)).toBe(true)
    // And whenever the chip clears, the label clears with it (no orphan label over an empty popover).
    if (out.chipFeature === null) expect(out.label).toBe('')
  })
})

describe('totality on malformed Orky state (REQ-019)', () => {
  it('TEST-019 REQ-019 mappers + normalizers tolerate empty/malformed input without throwing', () => {
    expect(() => orkyFeatureStatus(raw({}), [], false, null, null, NOW, 120_000)).not.toThrow()
    expect(() => orkyFeatureStatus({} as never, undefined as never, false, null, null, NOW, 120_000)).not.toThrow()
    expect(normalizeFindings(undefined as never)).toEqual([])
    expect(normalizeFindings('garbage' as never)).toEqual([])
    const nf = normalizeFeatureRaw(undefined as never)
    expect(nf.gates).toEqual({})
    expect(nf.escalations).toEqual([])
  })
})

describe('no persisted schema bump (REQ-018)', () => {
  it('TEST-020 REQ-018 SCHEMA_VERSION is NOT bumped by this feature (live runtime state only)', () => {
    expect(SCHEMA_VERSION).toBe(7) // status is live; nothing new is persisted
  })
})
