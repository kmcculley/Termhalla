// Hardening suite — findings status/severity fold case to match the producer's contract.
// Orky's gatekeeper compares finding `status` case-insensitively (canonical lowercase, e.g. "open")
// and `severity` case-insensitively (canonical UPPERCASE, e.g. "HIGH") — its own `contract` command
// documents this under `finding_normalization`. Termhalla's `openBlockingCount` previously compared
// both EXACT-case (`f.status !== 'open'`, severity against {'CRITICAL','HIGH'} verbatim), so a
// mixed-case finding a producer legitimately treats as open-and-blocking silently dropped out of the
// chip's `●k open` count. This suite pins the case-insensitive fold.
import { describe, it, expect } from 'vitest'
import { openBlockingCount } from '@shared/orky-status'

describe('openBlockingCount — case-insensitive status/severity (producer-contract parity)', () => {
  it('mixed-case open + blocking findings ("Open"/"high", "OPEN"/"Critical") count', () => {
    expect(openBlockingCount([
      { status: 'Open', severity: 'high' },
      { status: 'OPEN', severity: 'Critical' },
      { status: 'open', severity: 'HIGH' } // canonical form still counts, unchanged
    ] as never)).toBe(3)
  })

  it('a mixed-case open contract violation counts regardless of severity case', () => {
    expect(openBlockingCount([{ status: 'Open', severity: 'medium', contract_violation: true }] as never)).toBe(1)
  })

  it('non-open statuses stay excluded in any case; non-blocking severities stay excluded in any case', () => {
    expect(openBlockingCount([
      { status: 'Resolved', severity: 'HIGH' },
      { status: 'DEFERRED', severity: 'Critical' },
      { status: 'Open', severity: 'Low' },
      { status: 'Open', severity: 'medium' }
    ] as never)).toBe(0)
  })

  it('stays total on garbage: a missing status/severity never counts and never throws', () => {
    expect(openBlockingCount([{ severity: 'HIGH' }, { status: 'Open' }, {}] as never)).toBe(0)
  })
})
