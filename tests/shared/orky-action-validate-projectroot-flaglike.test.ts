// FROZEN unit suite — feature 0012-quick-capture-inbox, REVISION 2 (ESC-001 loopback; phase 4 /
// TASK-002-adjacent, REQ-013 — the FINDING-011 hardening). Targets `src/shared/orky-action-validate.ts`.
//
// Today every free-text field that travels as its OWN raw argv element — feature, escalationId,
// decision, evidence — is defended by `rejectFlagLike` (rejects a leading `--`) BEFORE it can reach a
// CLI. `projectRoot` is the one exception: it flows straight from `requireNonEmptyString` into the raw
// `'--app', projectRoot` argv position in all four dispatch paths, its safety resting on the
// UNENFORCED invariant that registry roots are `path.resolve()`d (an OS-absolute path can never start
// with `--`). F12 is the first renderer-reachable feature to depend on it, and REQ-004/F10's
// pre-selected-root path will lean on it harder. REQ-013 adds `rejectFlagLike('projectRoot', …)` to
// ALL FOUR validators immediately after the `projectRoot` extraction, with the guard's standard
// field-specific message (CONV-001).
//
// This file is NEW — the frozen `tests/shared/orky-action-validate.test.ts` (TEST-148..290) stays
// byte-preserved (its assertions never used a flag-like root, grep-verified, so it stays green). These
// pins are authored RED against the not-yet-hardened validators (defense-in-depth per REQ-013).
//
// Runs RED today: none of the four validators rejects a `--`-prefixed projectRoot — each currently
// accepts it via requireNonEmptyString and returns ok:true (or fails later on a different field).
import { describe, it, expect } from 'vitest'
import {
  validateResolveEscalationRequest,
  validateSubmitWorkRequest,
  validateRecordHumanGateRequest,
  validateDriveStatusRequest
} from '../../src/shared/orky-action-validate'

const FLAG_LIKE_ROOT = '--evil'
const EXPECTED_MSG = "projectRoot must not start with '--' (reserved for CLI flags)"

// One fully-otherwise-valid request per validator, so the ONLY reason each can reject is projectRoot.
const wellFormed = {
  resolveEscalation: { projectRoot: FLAG_LIKE_ROOT, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' },
  submitWork: { projectRoot: FLAG_LIKE_ROOT, title: 'fix the thing' },
  recordHumanGate: { projectRoot: FLAG_LIKE_ROOT, feature: 'f1', gate: 'human-review', verdict: 'pass' },
  driveStatus: { projectRoot: FLAG_LIKE_ROOT, feature: 'f1' }
} as const

describe('projectRoot rejectFlagLike guard in ALL FOUR validators (REQ-013, FINDING-011)', () => {
  it('TEST-512 REQ-013 validateResolveEscalationRequest rejects a --prefixed projectRoot with the field-specific flag-like message', () => {
    const r = validateResolveEscalationRequest(wellFormed.resolveEscalation)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe(EXPECTED_MSG)
  })

  it('TEST-513 REQ-013 validateSubmitWorkRequest rejects a --prefixed projectRoot with the field-specific flag-like message (F12\'s own dispatch path)', () => {
    const r = validateSubmitWorkRequest(wellFormed.submitWork)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe(EXPECTED_MSG)
  })

  it('TEST-514 REQ-013 validateRecordHumanGateRequest rejects a --prefixed projectRoot with the field-specific flag-like message', () => {
    const r = validateRecordHumanGateRequest(wellFormed.recordHumanGate)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe(EXPECTED_MSG)
  })

  it('TEST-515 REQ-013 validateDriveStatusRequest rejects a --prefixed projectRoot with the field-specific flag-like message', () => {
    const r = validateDriveStatusRequest(wellFormed.driveStatus)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe(EXPECTED_MSG)
  })

  it('TEST-516 REQ-013 the projectRoot flag-like guard fires BEFORE any other field check (its message is returned even when a LATER field is also invalid — a pure-shape gate, no CLI reachable)', () => {
    // Every other field simultaneously invalid; the projectRoot guard must still win (it sits right
    // after the projectRoot extraction, ahead of feature/escalationId/decision/title/gate/verdict).
    const submit = validateSubmitWorkRequest({ projectRoot: FLAG_LIKE_ROOT, title: '' /* also invalid */ })
    expect(submit.ok).toBe(false)
    if (!submit.ok) expect(submit.error).toBe(EXPECTED_MSG)
    const drive = validateDriveStatusRequest({ projectRoot: FLAG_LIKE_ROOT /* feature missing */ })
    expect(drive.ok).toBe(false)
    if (!drive.ok) expect(drive.error).toBe(EXPECTED_MSG)
  })

  it('TEST-517 REQ-013 the new message is PAIRWISE-DISTINCT from every existing projectRoot rejection reason (the CONV-001 matrix): empty vs missing vs non-string vs flag-like all differ', () => {
    const messages = [
      validateSubmitWorkRequest({ projectRoot: FLAG_LIKE_ROOT, title: 't' }),   // flag-like
      validateSubmitWorkRequest({ projectRoot: '', title: 't' }),                // empty
      validateSubmitWorkRequest({ title: 't' }),                                 // missing
      validateSubmitWorkRequest({ projectRoot: 42, title: 't' })                 // non-string
    ].map(r => (r.ok ? '' : r.error))
    expect(new Set(messages).size).toBe(messages.length)
    expect(messages[0]).toBe(EXPECTED_MSG)
  })

  it('TEST-518 REQ-013 a legitimate OS-absolute projectRoot is UNaffected — no false positive (Windows drive path and POSIX path both accepted)', () => {
    const win = validateSubmitWorkRequest({ projectRoot: 'C:\\Mixed\\Case Root', title: 't' })
    expect(win.ok).toBe(true)
    const posix = validateDriveStatusRequest({ projectRoot: '/home/kev/proj', feature: 'f1' })
    expect(posix.ok).toBe(true)
  })
})
