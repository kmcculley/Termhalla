// Phase-4 unit suite — feature 0014-orky-osc-heartbeat (REQ-009/010/011/013). FROZEN once the tests
// gate passes (ADR-009): the implementer makes these pass without editing them.
//
// REWRITTEN against the REAL ADR-026 wire shape: `OrkyHeartbeat` no longer carries `kind`/`openBlocking`/
// `failed` straight off the wire (the prior, superseded 8888/key=value grammar did) — `kind` is now
// DERIVED in `orkyHeartbeatToPaneStatus` from `needsHuman`/`phase`/`gateN`/`gateM` (REQ-009), and
// `openBlocking`/`failed` default deterministically (the wire does not carry them). `reason` is now a
// free-form `string | null` (Orky's own prose), not the closed `OrkyReason` union.
//
// `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` are pure shared functions — these tests build
// `OrkyHeartbeat`-shaped object literals BY HAND (matching `02-spec.md`'s "Public interface" section)
// rather than going through `OrkyOscParser`, exactly as `03-plan.md` calls out for TASK-005 ("type-only
// dep on TASK-001 — pure shared code, no runtime dependency on the parser file"). This decouples
// REQ-009/010/011/013 (this file) from REQ-001..008 (tests/main/orky-osc-parser.test.ts): either suite
// can run RED/GREEN independently of the other's implementation state.
//
// Runs RED: `src/shared/orky-status.ts`'s `heartbeatToFeatureStatus`/`orkyHeartbeatToPaneStatus` still
// pass the stale `kind`/`openBlocking`/`failed` wire fields straight through (the old 8888 shape) rather
// than deriving `kind` and defaulting `openBlocking`/`failed` per the new ADR-026 contract, so the
// shapes asserted below do not match.
import { describe, it, expect } from 'vitest'
import { orkyHeartbeatToPaneStatus, selectOrkyPaneStatus } from '@shared/orky-status'
import {
  AWAITING_HUMAN_HEARTBEAT, BUSY_HEARTBEAT, DONE_HEARTBEAT, APP_LOOP_HEARTBEAT
} from '../fixtures/orky-osc-fixtures'

describe('orkyHeartbeatToPaneStatus — reuses 0004\'s orkyPaneStatus presentation, kind derived not carried (REQ-009)', () => {
  it('TEST-023 REQ-009 the worked-example awaiting-human heartbeat maps to kind needs-input with the exact chip shape', () => {
    const out = orkyHeartbeatToPaneStatus(AWAITING_HUMAN_HEARTBEAT as never)
    expect(out.kind).toBe('needs-input')
    expect(out.label).toBe('0004-orky-status-awareness · human-review · 7/8')
    expect(out.needsHuman).toBe(true)
    expect(out.features.length).toBe(1)
    expect(out.chipFeature).toBe('0004-orky-status-awareness')
  })

  it('TEST-024 REQ-009 a busy heartbeat (needsHuman false, gate not complete) maps to kind busy with the exact chip shape', () => {
    const out = orkyHeartbeatToPaneStatus(BUSY_HEARTBEAT as never)
    expect(out.kind).toBe('busy')
    expect(out.label).toBe('auth-login · implement · 5/8')
    expect(out.needsHuman).toBe(false)
  })

  it('TEST-025 REQ-009 a complete heartbeat (phase null, gateN===gateM, needsHuman false) maps to the same clean-done roll-up 0004 returns for an all-clean project', () => {
    const out = orkyHeartbeatToPaneStatus(DONE_HEARTBEAT as never)
    expect(out).toEqual({ kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null })
  })
})

describe('orkyHeartbeatToPaneStatus — synthesized detail is actionable, never bare text (REQ-010, CONV-001)', () => {
  it('TEST-026 REQ-010 needsHuman true with a reason present: detail names the feature and includes the reason verbatim', () => {
    const out = orkyHeartbeatToPaneStatus(AWAITING_HUMAN_HEARTBEAT as never)
    const detail = out.features[0].detail
    expect(detail).toContain('0004-orky-status-awareness')
    expect(detail).toContain('human-review is a human gate')
  })

  it('TEST-027 REQ-010 needsHuman true with NO reason: detail names the feature and states it needs a human, with no empty/undefined reason fragment', () => {
    const hb = { ...AWAITING_HUMAN_HEARTBEAT, reason: null }
    const out = orkyHeartbeatToPaneStatus(hb as never)
    const detail = out.features[0].detail
    expect(detail).toContain('0004-orky-status-awareness')
    expect(detail).not.toMatch(/undefined|null/i)
    expect(detail.length).toBeGreaterThan('0004-orky-status-awareness'.length)
  })

  it('TEST-028 REQ-010 a plain busy heartbeat: detail names the feature and its live phase', () => {
    const out = orkyHeartbeatToPaneStatus(BUSY_HEARTBEAT as never)
    const detail = out.features[0].detail
    expect(detail).toContain('auth-login')
    expect(detail).toContain('implement')
  })
})

describe('orkyHeartbeatToPaneStatus — a feature-less (app-loop) heartbeat maps to the cleared shape, not a fabricated chip (REQ-011)', () => {
  it('TEST-030 REQ-011 orkyHeartbeatToPaneStatus(appLoopHeartbeat) returns the cleared/empty shape; action never becomes a feature chip', () => {
    const out = orkyHeartbeatToPaneStatus(APP_LOOP_HEARTBEAT as never)
    expect(out).toEqual({ kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null })
  })
})

describe('selectOrkyPaneStatus — filesystem-derived status wins; stream is a fallback only (REQ-013)', () => {
  const fsStatus = { kind: 'busy', label: 'fs-feature · implement · 4/8', needsHuman: false, failed: false, features: [], chipFeature: 'fs-feature' } as never
  const streamStatus = { kind: 'idle', label: 'stream-feature · plan · 2/8', needsHuman: false, failed: false, features: [], chipFeature: 'stream-feature' } as never

  it('TEST-032 REQ-013 returns fsStatus whenever it is non-null, regardless of streamStatus', () => {
    expect(selectOrkyPaneStatus(fsStatus, streamStatus)).toBe(fsStatus)
  })

  it('TEST-033 REQ-013 returns streamStatus when fsStatus is null', () => {
    expect(selectOrkyPaneStatus(null, streamStatus)).toBe(streamStatus)
    expect(selectOrkyPaneStatus(fsStatus, null)).toBe(fsStatus)
  })

  it('TEST-034 REQ-013 returns null when both are null', () => {
    expect(selectOrkyPaneStatus(null, null)).toBeNull()
  })
})
