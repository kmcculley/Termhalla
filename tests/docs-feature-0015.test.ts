// FROZEN doc-drift guard — feature 0015-orky-contract-v2-refresh (phase 4 — REQ-107's named sites +
// REQ-105(c)'s provenance auditability; TASK-104/106/107/108). POSITIVE presence pins over the
// exact files the spec names — deliberately NOT the repo-wide CONV-023 grep sweep (those scans stay
// the review-time authority per REQ-107's acceptance; historical artifacts — CHANGELOG past
// entries, .orky/features/* archives, docs/superpowers/* — are exempt and never read here).
//
//   • src/shared/orky-status.ts — the provenance comment's quoted PHASE_ORDER literal must end
//     'human-review' (not 'human'); the still-live intake-excluded warning and the "do not re-sync
//     against PHASE_ORDER" instruction survive; the human→human-review rename is recorded as
//     RESOLVED-at-contract-v2 (historical), never deleted.
//   • docs/features/orky-status.md § Data provenance — the same v2-reconciled text.
//   • docs/features/orky-action-dispatch.md — the stale "expected `1`" contract-version claim is
//     gone; the handshake pin reads 2.
//   • CHANGELOG [Unreleased] — the regeneration provenance: plugin version 0.30.0 recorded
//     alongside the generator command (REQ-105(c)).
//
// Runs RED today (2026-07-03): the quoted PHASE_ORDER in both provenance sites still ends 'human',
// orky-action-dispatch.md still says expected `1`, and no 0.30.0 provenance is in [Unreleased].
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fileRaw = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

function unreleasedSection(): string {
  const changelog = fileRaw('CHANGELOG.md')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

/** The § Data provenance section of docs/features/orky-status.md (scoped so pins never match
 *  unrelated escalation/finding prose elsewhere in the doc). */
function provenanceSection(): string {
  const doc = fileRaw('docs/features/orky-status.md')
  const start = doc.indexOf('## Data provenance')
  expect(start, 'orky-status.md must keep its Data provenance section').toBeGreaterThanOrEqual(0)
  const rest = doc.slice(start)
  const next = rest.slice(2).search(/\n## /)
  return next === -1 ? rest : rest.slice(0, next + 2)
}

describe('TEST-719 REQ-107 REQ-105 provenance text reconciled to contract v2 (the CONV-008 named sites)', () => {
  it("src/shared/orky-status.ts: the quoted PHASE_ORDER ends 'human-review'; the intake warning and the do-not-re-sync instruction survive; the rename is recorded as resolved-at-v2, not deleted", () => {
    const src = fileRaw('src/shared/orky-status.ts')
    // the stale v1 quote (…,'doc-sync','human']) must be gone — this is the RED driver
    expect(src, "the quoted PHASE_ORDER literal must no longer end in 'human'").not.toMatch(/'doc-sync',\s*'human'\]/)
    // the reconciled quote ends 'human-review' (matches the ORKY_PHASES literal's tail too — fine:
    // both must read 'human-review')
    expect(src).toMatch(/'doc-sync',\s*'human-review'\]/)
    // BOTH intentional-difference warnings survive in version-aware form:
    //  (1) intake remains excluded — a still-live difference
    expect(src, 'the intake-excluded warning must survive').toMatch(/intake/)
    expect(src).toMatch(/excluded/i)
    //  (2) the human→human-review rename is recorded as historical / resolved at contract v2 —
    //      never silently deleted (the instruction stays load-bearing)
    expect(src, 'the rename must be recorded as resolved-at-contract-v2 / historical, not deleted')
      .toMatch(/historical|resolved (as of|at|by) (contract )?v2|contract v2/i)
    // the "do not re-sync ORKY_PHASES against PHASE_ORDER" instruction stays load-bearing
    expect(src).toMatch(/PHASE_ORDER/)
    expect(src).toMatch(/re-?sync/i)
  })

  it("docs/features/orky-status.md § Data provenance: same v2-reconciled text — quoted PHASE_ORDER ends 'human-review', both warnings survive, the rename is historical", () => {
    const sec = provenanceSection()
    expect(sec, "the doc's quoted PHASE_ORDER literal must no longer end in 'human'").not.toMatch(/'doc-sync',\s*'human'\]/)
    expect(sec).toMatch(/'doc-sync',\s*'human-review'\]/)
    expect(sec, 'the intake-excluded warning must survive').toMatch(/intake/)
    expect(sec).toMatch(/excluded/i)
    expect(sec, 'the rename must be recorded as historical / resolved at contract v2')
      .toMatch(/historical|resolved (as of|at|by) (contract )?v2|contract v2/i)
    expect(sec).toMatch(/PHASE_ORDER/)
    expect(sec).toMatch(/MUST NOT/i)
  })

  it('docs/features/orky-action-dispatch.md: the handshake pin no longer claims expected `1` — it reads 2', () => {
    const doc = fileRaw('docs/features/orky-action-dispatch.md')
    expect(doc, 'the stale expected-1 contract-version claim must be gone').not.toMatch(/expected\s*`1`/i)
    expect(doc, 'the handshake description must state the v2 pin').toMatch(/expected\s*`2`/i)
  })

  it('CHANGELOG [Unreleased] records the regeneration provenance: plugin 0.30.0 + the generator command (REQ-105c)', () => {
    const section = unreleasedSection()
    expect(section, 'the plugin version the fixtures were regenerated against must be recorded').toContain('0.30.0')
    expect(section, 'the regeneration command must be auditable').toContain('generate-orky-contract-fixtures')
  })
})
