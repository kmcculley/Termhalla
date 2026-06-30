// Phase-4 unit suite — feature 0014-orky-osc-heartbeat (REQ-006/007/009). FROZEN once the tests gate
// passes (ADR-009): the implementer makes these pass without editing them.
//
// `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` are pure shared functions — these tests build
// `OrkyHeartbeat`-shaped object literals BY HAND (matching `02-spec.md`'s "Public interface" section)
// rather than going through `OrkyOscParser`, exactly as `03-plan.md` calls out for TASK-004
// ("type-only dep on TASK-001 — pure shared code, no runtime dependency on the parser file"). This
// decouples REQ-006/007/009 (this file) from REQ-001..005 (tests/main/orky-osc-parser.test.ts): either
// suite can run RED/GREEN independently of the other's implementation state.
//
// TEST-IDs continue the feature-wide sequence from tests/main/orky-osc-parser.test.ts (TEST-001..021)
// and tests/main/orky-osc-structural.test.ts (TEST-022..031) — see 04-tests.md for the full catalogue.
//
// Runs RED: `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` are not exported by
// `src/shared/orky-status.ts` yet.
import { describe, it, expect } from 'vitest'
import { orkyHeartbeatToPaneStatus, selectOrkyPaneStatus } from '@shared/orky-status'
import { WORKED_EXAMPLE_HEARTBEAT } from '../fixtures/orky-osc-fixtures'

// A minimal, valid-shaped OrkyHeartbeat builder — every field defaults to the spec's worked-example
// busy shape; callers override only what the test cares about.
function hb(overrides: Partial<typeof WORKED_EXAMPLE_HEARTBEAT> & Record<string, unknown> = {}) {
  return { ...WORKED_EXAMPLE_HEARTBEAT, ...overrides } as never
}

describe('orkyHeartbeatToPaneStatus — reuses 0004\'s orkyPaneStatus presentation (REQ-006)', () => {
  it('TEST-032 REQ-006 the worked-example busy heartbeat maps to the exact chip shape 0004 would render for the same feature', () => {
    const out = orkyHeartbeatToPaneStatus(hb())
    expect(out.kind).toBe('busy')
    expect(out.label).toBe('auth-login · implement · 5/8 · ●2 open')
    expect(out.needsHuman).toBe(false)
    expect(out.features.length).toBe(1)
    expect(out.chipFeature).toBe('auth-login')
  })

  it('TEST-033 REQ-006 a clean idle heartbeat (o=0,h=0,x=0) maps to the same empty/idle shape 0004 returns for an all-clean roll-up', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      kind: 'idle', phase: 'plan', gateN: 2, gateM: 8, openBlocking: 0, needsHuman: false, failed: false, reason: null
    }))
    expect(out).toEqual({ kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null })
  })

  it('TEST-034 REQ-006 a needs-input heartbeat (h=1,r=human-review) maps to kind needs-input, needsHuman true, included in features', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'release-flow', kind: 'needs-input', phase: 'doc-sync', gateN: 7, gateM: 8,
      openBlocking: 1, needsHuman: true, failed: false, reason: 'human-review'
    }))
    expect(out.kind).toBe('needs-input')
    expect(out.needsHuman).toBe(true)
    expect(out.features.some(f => f.feature === 'release-flow')).toBe(true)
    expect(out.chipFeature).toBe('release-flow')
  })

  it('TEST-035 REQ-006 a `done`/phase:"done" heartbeat with open findings renders without a literal "null" chip (FINDING-DA-007 guard) and keeps the gate fraction', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'old-feature', kind: 'done', phase: 'done', gateN: 8, gateM: 8,
      openBlocking: 2, needsHuman: false, failed: false, reason: null
    }))
    expect(out.kind).toBe('done')
    expect(out.label).not.toContain('null')
    expect(out.label).toContain('8/8')
    expect(out.label).toContain('old-feature')
    expect(out.chipFeature).toBe('old-feature') // done-WITH-open-findings is popover-eligible
  })

  it('TEST-036 REQ-006 a CLEAN done heartbeat (phase:"done", openBlocking 0) is excluded from the popover, same as a clean-done fs-sourced feature', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'clean-feature', kind: 'done', phase: 'done', gateN: 8, gateM: 8,
      openBlocking: 0, needsHuman: false, failed: false, reason: null
    }))
    expect(out).toEqual({ kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null })
  })
})

describe('orkyHeartbeatToPaneStatus — synthesized detail is actionable (REQ-007)', () => {
  it('TEST-037 REQ-007 a needs-input/human-review heartbeat\'s detail names the feature and "human-review", never a bare "needs input"', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'auth-flow', kind: 'needs-input', phase: 'doc-sync', gateN: 7, gateM: 8,
      openBlocking: 0, needsHuman: true, failed: false, reason: 'human-review'
    }))
    const detail = out.features[0].detail
    expect(detail).not.toBe('needs input')
    expect(detail.toLowerCase()).toContain('auth-flow')
    expect(detail.toLowerCase()).toContain('human-review')
  })

  it('TEST-038 REQ-007 a failed (x=1) heartbeat\'s detail names the feature and the failure, never a bare "error"', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'broken-flow', kind: 'idle', phase: 'review', gateN: 5, gateM: 8,
      openBlocking: 0, needsHuman: false, failed: true, reason: null
    }))
    const detail = out.features[0].detail
    expect(detail).not.toBe('error')
    expect(detail.toLowerCase()).toContain('broken-flow')
    expect(detail.toLowerCase()).toContain('fail')
  })

  it('TEST-039 REQ-007 a plain busy heartbeat\'s detail names the feature and the live phase', () => {
    const out = orkyHeartbeatToPaneStatus(hb({
      feature: 'busy-flow', kind: 'busy', phase: 'tests', gateN: 3, gateM: 8,
      openBlocking: 0, needsHuman: false, failed: false, reason: null
    }))
    const detail = out.features[0].detail
    expect(detail.toLowerCase()).toContain('busy-flow')
    expect(detail.toLowerCase()).toContain('tests')
  })
})

describe('selectOrkyPaneStatus — filesystem-derived status wins; stream is a fallback only (REQ-009)', () => {
  const fsStatus = { kind: 'busy', label: 'fs-feature · implement · 4/8', needsHuman: false, failed: false, features: [], chipFeature: 'fs-feature' } as never
  const streamStatus = { kind: 'idle', label: 'stream-feature · plan · 2/8', needsHuman: false, failed: false, features: [], chipFeature: 'stream-feature' } as never

  it('TEST-040 REQ-009 returns fsStatus whenever it is non-null, regardless of streamStatus', () => {
    expect(selectOrkyPaneStatus(fsStatus, streamStatus)).toBe(fsStatus)
    expect(selectOrkyPaneStatus(fsStatus, null)).toBe(fsStatus)
  })

  it('TEST-041 REQ-009 returns streamStatus when fsStatus is null', () => {
    expect(selectOrkyPaneStatus(null, streamStatus)).toBe(streamStatus)
  })

  it('TEST-042 REQ-009 returns null when both are null', () => {
    expect(selectOrkyPaneStatus(null, null)).toBeNull()
  })
})
