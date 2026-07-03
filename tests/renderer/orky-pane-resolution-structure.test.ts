// 0015-orky-contract-v2-refresh — phase 4 (tests), REQ-110 / TASK-112 (structural half).
// The Orky pane's finding rows display the v2 finding_resolution details on RESOLVED findings only:
// when a finding's status case-insensitively equals 'resolved' (the producer's finding_normalization
// contract / the existing isBlockingFinding discipline — NOT the escalation row's strict `===`) AND
// its resolution is non-null, the row appends a dim `— resolution: <resolution>` affix (the
// resolved-escalation `— decision:` precedent), surfacing resolvedBy / a formatted resolvedAt on the
// same row (inline or via the row's title — implementer's choice, but observable).
//
// The vitest harness is node-env with no jsdom (vitest.config.ts), so this suite pins the contract
// the repo's established source-scan way (the tests/renderer/orky-pane-display-contract.test.ts
// precedent); the RENDERED vectors — including the open / resolved-with-null-resolution rows staying
// byte-identical to today — are pinned end-to-end in tests/e2e/orky-pane-resolution.spec.ts
// (TEST-716/TEST-717).
//
// Runs RED today (2026-07-03, against the shipped F9/F10 OrkyPane): the finding row renders only
// id/severity/status/blocking/claim — no resolution affix, no resolvedBy/resolvedAt consumption,
// and no case-insensitive resolved comparison exists in the file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pane = (): string => readFileSync(resolve(process.cwd(), 'src/renderer/components/OrkyPane.tsx'), 'utf8')

describe('finding rows surface finding_resolution on resolved findings only (REQ-110)', () => {
  it('TEST-715 REQ-110: the finding row consumes resolution/resolvedBy/resolvedAt behind a CASE-INSENSITIVE resolved check + a non-null resolution guard, renders the `— resolution:` affix, and formats the carried resolvedAt epoch via the shared formatter (never a renderer clock)', () => {
    const src = pane()

    // the affix literal itself (the resolved-escalation `— decision:` precedent, resolution flavor)
    expect(src, 'the dim `— resolution:` affix must exist').toMatch(/—\s?resolution:/)

    // the three carried v2 fields are consumed
    expect(src, 'the row must consume the carried resolution').toMatch(/\.resolution\b/)
    expect(src, 'the row must consume the carried resolvedBy').toMatch(/\.resolvedBy\b/)
    expect(src, 'the row must consume the carried resolvedAt').toMatch(/\.resolvedAt\b/)

    // resolved-ness is compared CASE-INSENSITIVELY (the producer's finding_normalization contract /
    // isBlockingFinding's discipline) — never the escalation row's strict `===` on the raw string
    expect(src, 'the finding resolved check must case-fold before comparing')
      .toMatch(/toLowerCase\(\)\s*===\s*'resolved'|toUpperCase\(\)\s*===\s*'RESOLVED'/)
    // exactly ONE strict `status === 'resolved'` may remain in the file — the ESCALATION row's
    // existing check; the finding row must not add a second (that shape misses 'Resolved')
    expect((src.match(/status\s*===\s*'resolved'/g) ?? []).length,
      "the finding row must not compare status with strict === 'resolved' (the escalation row's single existing site is the only one allowed)")
      .toBeLessThanOrEqual(1)

    // a resolved finding with resolution === null renders NO affix (and never `— resolution: null`):
    // the affix must be guarded on a non-null resolution
    expect(src, 'the affix must be guarded on resolution !== null').toMatch(/resolution\s*!==\s*null/)

    // resolvedAt is the payload's carried EPOCH — surfaced through the shared pure formatter, never
    // re-derived with a renderer clock (REQ-015 discipline; TEST-430/TEST-451's standing ban)
    expect(src, 'resolvedAt must flow through formatOrkyInstant').toMatch(/formatOrkyInstant\([^)]*resolvedAt/)
    expect(src).not.toMatch(/Date\.now\(|new Date\(/)
  })
})
