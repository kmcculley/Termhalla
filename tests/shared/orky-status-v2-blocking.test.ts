// 0015-orky-contract-v2-refresh — phase 4 (tests), REQ-111 / TASK-113 (the testable half).
// Binding decision 5: `isBlockingFinding` / `openBlockingCount` in src/shared/orky-status.ts MUST
// NOT be modified — a v2-shaped RESOLVED finding (now carrying the finding_resolution fields
// resolution/resolvedBy/resolvedAt) already stops counting via the existing case-insensitive
// `status !== 'open'` check. This suite pins that invariant with the v2-shaped vectors.
//
// DELIBERATELY GREEN today (2026-07-03): it asserts the predicates' EXISTING behavior holds for the
// new input shape — it is a guard against an implementer "adapting" the predicates for v2, not a
// red-driver. (REQ-111's other acceptance half — `git diff` showing no change to either function —
// is a review-time check; the FROZEN suites tests/shared/orky-status-blocking.test.ts /
// tests/characterization-shared.test.ts passing unmodified backs it.)
import { describe, it, expect } from 'vitest'
import { isBlockingFinding, openBlockingCount, type OrkyFinding } from '@shared/orky-status'

describe('v2-shaped resolved findings never count as blocking (REQ-111 — predicates untouched)', () => {
  it('TEST-718 REQ-111: a resolved finding carrying the v2 finding_resolution fields is NOT blocking — for CRITICAL severity, mixed-case status, and even contract_violation — and openBlockingCount ignores it', () => {
    // the spec's literal vector
    const v2Resolved = {
      id: 'F-1', status: 'resolved', severity: 'CRITICAL',
      resolution: 'rewrote the guard', resolvedBy: 'kevin', resolvedAt: '2026-07-01T00:00:00Z'
    }
    expect(isBlockingFinding(v2Resolved)).toBe(false)

    // the producer's case-insensitive normalization contract: 'Resolved' is just as non-open
    expect(isBlockingFinding({ ...v2Resolved, status: 'Resolved' })).toBe(false)
    // even a contract_violation stops counting once resolved (the FINDING-007 vector, v2-shaped)
    expect(isBlockingFinding({ ...v2Resolved, contract_violation: true })).toBe(false)

    // control: the SAME shape with status open IS blocking (CRITICAL) — proving the verdicts above
    // flow from the status check, not from the predicate ignoring v2-shaped entries wholesale
    const v2Open = { ...v2Resolved, status: 'open', resolution: null, resolvedBy: null, resolvedAt: null }
    expect(isBlockingFinding(v2Open)).toBe(true)

    // the counter delegates to the same single predicate: only the open one counts
    const findings = [
      v2Resolved,
      { ...v2Resolved, status: 'Resolved' },
      v2Open,
      { id: 'F-2', status: 'open', severity: 'LOW' } // open but non-blocking severity
    ] as OrkyFinding[]
    expect(openBlockingCount(findings)).toBe(1)
  })
})
