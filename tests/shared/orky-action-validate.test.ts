// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-002).
// Targets `src/shared/orky-action-validate.ts` — pure request validation for the four `orkyAction:*`
// actions (REQ-005 feature-slug confinement, REQ-014 malformed/empty/boundary tolerance, CONV-001/002).
//
// Chosen contract (the plan's TASK-002 prose is authoritative; this suite freezes the exact shape):
//   validateFeatureSlug(slug: unknown): {ok:true; slug:string} | {ok:false; error:string}
//   validateResolveEscalationRequest(input: unknown): {ok:true; req:ResolveEscalationRequest} | {ok:false; error:string}
//   validateSubmitWorkRequest(input: unknown): {ok:true; req:SubmitWorkRequest} | {ok:false; error:string}
//   validateRecordHumanGateRequest(input: unknown): {ok:true; req:RecordHumanGateRequest} | {ok:false; error:string}
//   validateDriveStatusRequest(input: unknown): {ok:true; req:DriveStatusRequest} | {ok:false; error:string}
//
// Resolved judgment call (TASK-008 vs TASK-002 prose reconciliation — see 04-tests.md "Chosen contracts"):
// `gate` is validated here ONLY for shape (non-empty string) — the {brainstorm,human-review} SET
// restriction is a SEPARATE, dispatcher-level business rule (REQ-008's "independent of... gatekeeper.js's
// own enforcement") that returns the DISTINCT `errorKind:'gate-not-allowed'`, never `invalid-args`, for a
// shape-valid-but-disallowed gate like 'spec'. If this validator itself rejected 'spec' as invalid-args,
// REQ-008's acceptance ("gate:'spec' ... returns gate-not-allowed") could never be reached. `verdict` HAS
// no such split (its only two valid values ARE its whole shape) so it stays enum-checked here, and REQ-008
// explicitly says "a malformed verdict value returns invalid-args".
//
// Every distinct rejection reason carries its OWN message (CONV-001) — collapsing branches into one
// generic string breaks REQ-014's "field-specific message" acceptance. Never throws (CONV-002).
//
// Runs RED today: `src/shared/orky-action-validate.ts` does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import {
  validateFeatureSlug,
  validateResolveEscalationRequest,
  validateSubmitWorkRequest,
  validateRecordHumanGateRequest,
  validateDriveStatusRequest
} from '../../src/shared/orky-action-validate'

describe('validateFeatureSlug — single-segment confinement (REQ-005)', () => {
  it('TEST-148 REQ-005/014 a non-string slug is rejected with a type-specific message', () => {
    const r = validateFeatureSlug(42)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('feature must be a string')
  })

  it('TEST-149 REQ-005/014 an empty string is rejected with an empty-specific message, distinct from the type message', () => {
    const r = validateFeatureSlug('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('feature must not be empty')
  })

  it('TEST-150 REQ-005 a slug containing a forward slash ("a/b") is rejected — never resolves outside .orky/features/', () => {
    const r = validateFeatureSlug('a/b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('feature must be a single path segment (no / or \\)')
  })

  it('TEST-151 REQ-005 a slug containing a backslash is rejected with the SAME single-segment message', () => {
    const r = validateFeatureSlug('a\\b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('feature must be a single path segment (no / or \\)')
  })

  it('TEST-152 REQ-005 a ".." traversal slug ("../../etc") is rejected (caught by the slash check first, still distinct from empty/type)', () => {
    const r = validateFeatureSlug('../../etc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/single path segment|\.\./)
  })

  it('TEST-153 REQ-005 a bare-dotdot slug with no slash (edge case) is rejected with a dedicated message', () => {
    const r = validateFeatureSlug('..')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('..')
  })

  it('TEST-154 REQ-005 a Windows drive-absolute slug with no separator ("C:foo") is rejected as an absolute path', () => {
    const r = validateFeatureSlug('C:foo')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('feature must not be an absolute path')
  })

  it('TEST-155 REQ-005 a well-formed single-segment slug is accepted and echoed back verbatim', () => {
    const r = validateFeatureSlug('0007-orky-action-dispatch')
    expect(r).toEqual({ ok: true, slug: '0007-orky-action-dispatch' })
  })

  it('TEST-156 CONV-001 every distinct FeatureSlug rejection above carries a UNIQUE message (never one generic string)', () => {
    const msgs = [42, '', 'a/b', 'a\\b', '..', 'C:foo']
      .map(v => validateFeatureSlug(v))
      .map(r => (r.ok ? '' : r.error))
    expect(new Set(msgs).size).toBe(msgs.length)
  })
})

describe('validateResolveEscalationRequest — malformed/empty/boundary (REQ-005/REQ-014)', () => {
  it('TEST-157 REQ-014 undefined input is rejected, never throws', () => {
    const r = validateResolveEscalationRequest(undefined)
    expect(r.ok).toBe(false)
  })

  it('TEST-158 REQ-014 a non-object primitive input is rejected with a request-shape message', () => {
    const r = validateResolveEscalationRequest('nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('request must be an object')
  })

  it('TEST-159 REQ-014 {} is rejected with a projectRoot-specific "is required" message', () => {
    const r = validateResolveEscalationRequest({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('projectRoot is required')
  })

  it('TEST-160 REQ-014 a non-string projectRoot is rejected with a message distinct from the missing case', () => {
    const missing = validateResolveEscalationRequest({})
    const wrongType = validateResolveEscalationRequest({ projectRoot: 42 })
    expect(wrongType.ok).toBe(false)
    if (!wrongType.ok && !missing.ok) {
      expect(wrongType.error).toBe('projectRoot must be a string')
      expect(wrongType.error).not.toBe(missing.error)
    }
  })

  it('TEST-161 REQ-005/014 a malformed feature slug propagates validateFeatureSlug\'s OWN message (single source of truth)', () => {
    const r = validateResolveEscalationRequest({ projectRoot: '/p', feature: '../../etc', escalationId: 'ESC-1', decision: 'yes' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/single path segment|\.\./)
  })

  it('TEST-162 REQ-014 empty escalationId and empty decision each return their OWN distinct message', () => {
    const base = { projectRoot: '/p', feature: 'f1' }
    const noId = validateResolveEscalationRequest({ ...base, escalationId: '', decision: 'approve' })
    const noDecision = validateResolveEscalationRequest({ ...base, escalationId: 'ESC-1', decision: '' })
    expect(noId.ok).toBe(false)
    expect(noDecision.ok).toBe(false)
    if (!noId.ok && !noDecision.ok) {
      expect(noId.error).not.toBe(noDecision.error)
      expect(noId.error).toContain('escalationId')
      expect(noDecision.error).toContain('decision')
    }
  })

  it('TEST-163 REQ-014 a missing escalationId/decision (undefined) is rejected with an "is required" message, never a throw', () => {
    const r = validateResolveEscalationRequest({ projectRoot: '/p', feature: 'f1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/escalationId is required/)
  })

  it('TEST-164 a well-formed request is accepted and echoed back with every field intact', () => {
    const input = { projectRoot: '/p', feature: 'f1', escalationId: 'ESC-1', decision: 'approve' }
    const r = validateResolveEscalationRequest(input)
    expect(r).toEqual({ ok: true, req: input })
  })
})

describe('validateSubmitWorkRequest — title required, feature/detail/phase optional (REQ-007/REQ-014)', () => {
  it('TEST-165 REQ-014 undefined/non-object input rejected, never throws', () => {
    expect(validateSubmitWorkRequest(undefined).ok).toBe(false)
    expect(validateSubmitWorkRequest(5).ok).toBe(false)
  })

  it('TEST-166 REQ-007/014 a missing title is rejected with a title-specific "is required" message', () => {
    const r = validateSubmitWorkRequest({ projectRoot: '/p' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('title is required')
  })

  it('TEST-167 REQ-007/014 an empty-string title is rejected with a message distinct from "missing"', () => {
    const missing = validateSubmitWorkRequest({ projectRoot: '/p' })
    const empty = validateSubmitWorkRequest({ projectRoot: '/p', title: '' })
    expect(empty.ok).toBe(false)
    if (!empty.ok && !missing.ok) expect(empty.error).not.toBe(missing.error)
  })

  it('TEST-168 REQ-014 a non-string optional detail/phase is rejected with a field-specific message; feature is truly optional', () => {
    const okNoFeature = validateSubmitWorkRequest({ projectRoot: '/p', title: 'do the thing' })
    expect(okNoFeature.ok).toBe(true)
    const badDetail = validateSubmitWorkRequest({ projectRoot: '/p', title: 't', detail: 123 })
    expect(badDetail.ok).toBe(false)
    if (!badDetail.ok) expect(badDetail.error).toBe('detail must be a string')
    const badPhase = validateSubmitWorkRequest({ projectRoot: '/p', title: 't', phase: 123 })
    expect(badPhase.ok).toBe(false)
    if (!badPhase.ok) expect(badPhase.error).toBe('phase must be a string')
  })

  it('TEST-169 a fully-populated valid request round-trips exactly', () => {
    const input = { projectRoot: '/p', feature: 'f1', title: 't', detail: 'd', phase: 'implement' }
    expect(validateSubmitWorkRequest(input)).toEqual({ ok: true, req: input })
  })
})

describe('validateRecordHumanGateRequest — SHAPE only for gate; verdict enum-checked (REQ-008/REQ-014)', () => {
  it('TEST-170 REQ-014 a missing gate/verdict each return a field-specific "is required" message', () => {
    const noGate = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', verdict: 'pass' })
    const noVerdict = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', gate: 'human-review' })
    expect(noGate.ok).toBe(false)
    expect(noVerdict.ok).toBe(false)
    if (!noGate.ok && !noVerdict.ok) {
      expect(noGate.error).toBe('gate is required')
      expect(noVerdict.error).toBe('verdict is required')
    }
  })

  it('TEST-171 REQ-008 a SHAPE-VALID but disallowed gate value ("spec") passes THIS validator — the {brainstorm,human-review} restriction is NOT enforced here (it is the dispatcher\'s own REQ-008 check)', () => {
    const r = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', gate: 'spec', verdict: 'pass' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.gate).toBe('spec')
  })

  it('TEST-172 REQ-008 a malformed verdict ("maybe") IS rejected here as invalid-args-shaped (verdict has no separate business-rule layer)', () => {
    const r = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', gate: 'human-review', verdict: 'maybe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("verdict must be 'pass' or 'fail'")
  })

  it('TEST-173 REQ-014 an optional non-string evidence is rejected with a field-specific message; evidence is otherwise optional', () => {
    const ok = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    expect(ok.ok).toBe(true)
    const bad = validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f1', gate: 'brainstorm', verdict: 'pass', evidence: 7 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('evidence must be a string')
  })

  it('TEST-174 REQ-005 feature is REQUIRED for recordHumanGate (unlike submitWork) — missing feature is rejected', () => {
    const r = validateRecordHumanGateRequest({ projectRoot: '/p', gate: 'brainstorm', verdict: 'pass' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/feature is required/)
  })
})

describe('validateDriveStatusRequest — read-only request, feature required (REQ-009/REQ-014)', () => {
  it('TEST-175 REQ-014 a missing projectRoot/feature is rejected, never throws', () => {
    expect(validateDriveStatusRequest({}).ok).toBe(false)
    expect(validateDriveStatusRequest({ projectRoot: '/p' }).ok).toBe(false)
  })

  it('TEST-176 a well-formed request round-trips exactly', () => {
    const input = { projectRoot: '/p', feature: 'f1' }
    expect(validateDriveStatusRequest(input)).toEqual({ ok: true, req: input })
  })
})

describe('CONV-001 — messages across the whole malformed-input matrix are pairwise distinct, never generic', () => {
  it('TEST-177 no validator ever returns a bare "error"/"invalid input"/"invalid" string, and every distinct rejection across all four validators is unique', () => {
    const errors: string[] = []
    const collect = (r: { ok: boolean; error?: string }): void => { if (!r.ok && r.error) errors.push(r.error) }
    collect(validateResolveEscalationRequest(undefined))
    collect(validateResolveEscalationRequest({}))
    collect(validateResolveEscalationRequest({ projectRoot: 1 }))
    collect(validateResolveEscalationRequest({ projectRoot: '/p' }))
    collect(validateResolveEscalationRequest({ projectRoot: '/p', feature: 'f', escalationId: '' }))
    collect(validateResolveEscalationRequest({ projectRoot: '/p', feature: 'f', escalationId: 'E', decision: '' }))
    collect(validateSubmitWorkRequest({}))
    collect(validateSubmitWorkRequest({ projectRoot: '/p', title: '' }))
    collect(validateSubmitWorkRequest({ projectRoot: '/p', title: 't', detail: 1 }))
    collect(validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f' }))
    collect(validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f', gate: 'brainstorm' }))
    collect(validateRecordHumanGateRequest({ projectRoot: '/p', feature: 'f', gate: 'brainstorm', verdict: 'maybe' }))
    collect(validateDriveStatusRequest({}))

    for (const e of errors) {
      expect(e.toLowerCase()).not.toBe('error')
      expect(e.toLowerCase()).not.toBe('invalid input')
      expect(e.toLowerCase()).not.toBe('invalid')
      expect(e.length).toBeGreaterThan(8) // a real, actionable sentence fragment, not a stub
    }
  })
})
