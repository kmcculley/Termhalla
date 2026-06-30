// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / pure-logic core).
// These pin the determinism + data-provenance anchors of the Orky status mappers (TASK-001..007).
// Every mapper is total (never throws on empty/malformed input) and pure (no Date.now / no I/O):
// `now` and `thresholdMs` are ALWAYS injected, so there is ZERO wall-clock dependence here.
//
// Runs RED today: `@shared/orky-status` does not exist yet, so the whole file errors on import — that
// IS the want-of-implementation signal (same convention as chip-status.test.ts for 0003).
import { describe, it, expect } from 'vitest'
import {
  ORKY_PHASES,
  gateN,
  openBlockingCount,
  isStalled,
  orkyFeatureStatus,
  selectChipFeature,
  orkyPaneStatus,
  normalizeFindings,
  normalizeFeatureRaw
} from '@shared/orky-status'
import { SCHEMA_VERSION } from '@shared/types'

// A fixed, injected clock — no test reads the wall clock (REQ-003 / REQ-021 determinism anchor).
const NOW = 1_700_000_000_000

// Build an on-disk-shaped raw feature (mirrors state.json). `feature` is the slug, `phase` the
// current phase, `gates` a map of phase -> { passed }, `escalations` the escalation list.
type RawGate = { passed?: boolean }
function raw(o: Partial<{
  feature: string
  phase: string
  gates: Record<string, RawGate>
  escalations: Array<{ id: string; status?: string; reason?: string }>
}> = {}): never {
  return { feature: 'auth', phase: 'implement', gates: {}, escalations: [], ...o } as never
}

// Build an OrkyFeatureStatus (the mapped, wire-shaped per-feature status the selector ranks).
// `reason` is the structured needs-you discriminator the REQ-007 ordering ranks on
// (escalation > stalled > human-review); null when the feature does not need a human.
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

describe('ORKY_PHASES + gate N/M (REQ-001)', () => {
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
    // MEDIUM/LOW by themselves are non-blocking, but a contract_violation pulls them in regardless of severity
    expect(openBlockingCount([{ status: 'open', severity: 'MEDIUM', contract_violation: true }] as never)).toBe(1)
    // resolved / deferred are excluded even at CRITICAL/HIGH
    expect(openBlockingCount([{ status: 'deferred', severity: 'HIGH' }, { status: 'acknowledged', severity: 'CRITICAL' }] as never)).toBe(0)
    // a missing `status` (i.e. not literally 'open') is non-blocking
    expect(openBlockingCount([{ severity: 'HIGH' }] as never)).toBe(0)
    // no capping: five blocking findings count as five
    expect(openBlockingCount(Array.from({ length: 5 }, () => ({ status: 'open', severity: 'HIGH' })) as never)).toBe(5)
  })
})

describe('isStalled — finished-wins, active-only, 120s boundary (REQ-003)', () => {
  const exec = raw({ feature: 'auth', phase: 'implement', gates: {} }) // executing: phase in flight, no gate entry yet

  it('TEST-005 REQ-003 stalls strictly above the injected threshold; the boundary itself is not stalled', () => {
    expect(isStalled('auth', exec, NOW - 121_000, NOW, 120_000)).toBe(true)
    expect(isStalled('auth', exec, NOW - 119_000, NOW, 120_000)).toBe(false)
    expect(isStalled('auth', exec, NOW - 120_000, NOW, 120_000)).toBe(false) // exactly 120s → NOT stalled (strict >)
  })

  it('TEST-006 REQ-003 finished-wins, non-active never stalls, null tick is false (total)', () => {
    const finished = raw({ feature: 'auth', phase: 'human-review', gates: { 'human-review': { passed: true } } })
    expect(isStalled('auth', finished, NOW - 10_000_000, NOW, 120_000)).toBe(false) // finished wins over an ancient tick
    expect(isStalled('other', exec, NOW - 121_000, NOW, 120_000)).toBe(false)        // a non-active feature has no live heartbeat
    expect(isStalled('auth', exec, null, NOW, 120_000)).toBe(false)                  // missing tick → false, no throw
  })
})

describe('orkyFeatureStatus — per-feature map into the terminal-status model (REQ-004/005/006)', () => {
  it('TEST-007 REQ-004 a mid-execution feature with a recent tick maps to busy / not-needs-human', () => {
    const r = raw({ feature: 'auth', phase: 'implement', gates: { brainstorm: { passed: true }, spec: { passed: true }, plan: { passed: true }, tests: { passed: true } } })
    const st = orkyFeatureStatus(r, [], true, NOW - 1_000, NOW, 120_000)
    expect(st.kind).toBe('busy')
    expect(st.needsHuman).toBe(false)
    expect(st.gateN).toBe(4)
    expect(st.gateM).toBe(8)
  })

  it('TEST-008 REQ-004/REQ-005 the human-review phase maps to needs-input / needs-human with an actionable detail', () => {
    const r = raw({ feature: 'auth', phase: 'human-review', gates: { brainstorm: { passed: true } } })
    const st = orkyFeatureStatus(r, [], true, NOW - 1_000, NOW, 120_000)
    expect(st.kind).toBe('needs-input')
    expect(st.needsHuman).toBe(true)
    expect(st.reason).toBe('human-review')
    expect(st.detail.toLowerCase()).toContain('auth')
    expect(st.detail.toLowerCase()).toContain('human-review')
  })

  it('TEST-009 REQ-004 a feature whose human-review gate has passed maps to done', () => {
    const r = raw({ feature: 'auth', phase: 'human-review', gates: allPassed() })
    const st = orkyFeatureStatus(r, [], false, null, NOW, 120_000)
    expect(st.kind).toBe('done')
    expect(st.needsHuman).toBe(false)
  })

  it('TEST-010 REQ-005 needsHuman = open-escalation OR stalled OR human-review; a quiet feature is false', () => {
    // (a) an open escalation mid-execution → needs-human, reason escalation
    const esc = raw({ feature: 'auth', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-3', status: 'open', reason: 'judgment call' }] })
    const s1 = orkyFeatureStatus(esc, [], true, NOW - 1_000, NOW, 120_000)
    expect(s1.needsHuman).toBe(true)
    expect(s1.reason).toBe('escalation')

    // (b) a stalled active feature → needs-human, reason stalled
    const s2 = orkyFeatureStatus(raw({ feature: 'auth', phase: 'implement', gates: {} }), [], true, NOW - 200_000, NOW, 120_000)
    expect(s2.needsHuman).toBe(true)
    expect(s2.reason).toBe('stalled')

    // (c) an idle feature between two passed gates, no escalation, not active/stalled → NOT needs-human
    const idle = raw({ feature: 'auth', phase: 'plan', gates: { brainstorm: { passed: true }, spec: { passed: true }, plan: { passed: true } } })
    expect(orkyFeatureStatus(idle, [], false, NOW - 1_000, NOW, 120_000).needsHuman).toBe(false)

    // (d) a RESOLVED escalation must not trigger needs-human (only status==='open' counts)
    const resolved = raw({ feature: 'auth', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-1', status: 'resolved' }] })
    expect(orkyFeatureStatus(resolved, [], true, NOW - 1_000, NOW, 120_000).needsHuman).toBe(false)
  })

  it('TEST-011 REQ-006 a gate FAILURE sets `failed` independently and does NOT, by itself, set needs-human', () => {
    // The current phase has an explicit gate entry that did not pass (the gate ran and halted).
    const failed = raw({ feature: 'auth', phase: 'review', gates: { brainstorm: { passed: true }, spec: { passed: true }, plan: { passed: true }, tests: { passed: true }, implement: { passed: true }, review: { passed: false } } })
    const sf = orkyFeatureStatus(failed, [], false, NOW - 1_000, NOW, 120_000)
    expect(sf.failed).toBe(true)
    expect(sf.needsHuman).toBe(false) // surfaces as failure styling (REQ-014), not as needs-input
    // a clean feature is not failed
    expect(orkyFeatureStatus(raw({ feature: 'auth', phase: 'implement', gates: { brainstorm: { passed: true } } }), [], true, NOW - 1_000, NOW, 120_000).failed).toBe(false)
  })

  it('TEST-012 REQ-004 the detail string is specific + actionable (CONV-001), never a bare "needs input"', () => {
    const esc = raw({ feature: 'auth-feature', phase: 'implement', gates: {}, escalations: [{ id: 'ESC-3', status: 'open', reason: 'design choice' }] })
    const d = orkyFeatureStatus(esc, [], true, NOW - 1_000, NOW, 120_000).detail
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
    // (1) needsHuman beats a much-more-recent idle feature
    const needs = feat({ feature: 'n', needsHuman: true, reason: 'stalled', lastActivityAt: 1 })
    const idle = feat({ feature: 'i', needsHuman: false, reason: null, lastActivityAt: 999 })
    expect(selectChipFeature([idle, needs] as never)!.feature).toBe('n')
    // (3) equal needsHuman + reason → most-recent activity wins
    const old = feat({ feature: 'old', needsHuman: true, reason: 'escalation', lastActivityAt: 1 })
    const fresh = feat({ feature: 'fresh', needsHuman: true, reason: 'escalation', lastActivityAt: 9 })
    expect(selectChipFeature([old, fresh] as never)!.feature).toBe('fresh')
    // (4) identical on (1)-(3) → feature id ascending
    const zeta = feat({ feature: 'zeta', needsHuman: true, reason: 'escalation', lastActivityAt: 5 })
    const alpha = feat({ feature: 'alpha', needsHuman: true, reason: 'escalation', lastActivityAt: 5 })
    expect(selectChipFeature([zeta, alpha] as never)!.feature).toBe('alpha')
    expect(selectChipFeature([alpha, zeta] as never)!.feature).toBe('alpha')
  })

  it('TEST-015 REQ-007 empty input returns null', () => {
    expect(selectChipFeature([])).toBeNull()
  })
})

describe('orkyPaneStatus — roll-up, chip label, and determinism (REQ-008/020/021)', () => {
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

  it('TEST-018 REQ-020 the popover feature list holds only non-Idle features, ranked by the selector order', () => {
    const a = feat({ feature: 'a', kind: 'idle', needsHuman: false, lastActivityAt: 5 })
    const b = feat({ feature: 'b', kind: 'busy', needsHuman: false, lastActivityAt: 3 })
    const c = feat({ feature: 'c', kind: 'needs-input', needsHuman: true, reason: 'escalation', lastActivityAt: 1 })
    const out = orkyPaneStatus([a, b, c] as never)
    expect(out.features.map((f: { feature: string }) => f.feature)).toEqual(['c', 'b']) // idle 'a' dropped; needs-human 'c' ranked first
    expect(out.chipFeature).toBe('c')
  })
})

describe('totality on malformed Orky state (REQ-019)', () => {
  it('TEST-019 REQ-019 mappers + normalizers tolerate empty/malformed input without throwing', () => {
    expect(() => orkyFeatureStatus(raw({}), [], false, null, NOW, 120_000)).not.toThrow()
    expect(() => orkyFeatureStatus({} as never, undefined as never, false, null, NOW, 120_000)).not.toThrow()
    // the parse/normalize layer degrades to defined safe defaults (gates:{}, escalations:[], findings:[])
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
