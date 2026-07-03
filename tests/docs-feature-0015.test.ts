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
//   • CHANGELOG [Unreleased] — the regeneration provenance in the version-agnostic shape (the
//     generation-time recorded producer leads as fact — REQ-105(c), amended).
//
// AMENDED 2026-07-03 — ESC-001 descent, tests-phase re-entry (TASK-115 + TASK-117):
//   • TEST-719's CHANGELOG pin no longer requires the spec-time literal 0.30.0 — amended REQ-105
//     forbids any assertion requiring a hardcoded version numeral. It now requires the
//     version-agnostic provenance shape `regenerated against plugin <semver> (commit <sha>)`,
//     which the generation-time recorded producer (0.32.0 / commit 1c59d74, per the 04-tests.md
//     TASK-103 execution record) satisfies and every future re-mirror will too. RED until
//     TASK-119 rewords the [Unreleased] entry so that shape leads.
//   • TEST-720 encodes amended REQ-107's prose-phrasing scan (4) as a frozen assertion (the
//     descent's RED signal for CLAUDE.md:179): every /intake.{1,5}human/ hit in CLAUDE.md and the
//     two provenance sites must continue "-review" or be explicitly labeled historical/pre-v2.
//     RED until TASK-118 fixes CLAUDE.md:179's "(intake…human)" parenthetical.
//   • TEST-721 pins new REQ-113: docs/features/orky-pane.md documents the resolution display
//     (three field names in the registry:detail payload description + the affix passage naming
//     both guards and the title mirror). RED until TASK-121 writes the section.
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

  it('CHANGELOG [Unreleased] records the regeneration provenance version-agnostically — the generation-time recorded producer leads: `regenerated against plugin <semver> (commit <sha>)` + the generator command (REQ-105c, amended ESC-001; NO spec-time version numeral is required)', () => {
    const section = unreleasedSection()
    // Amended REQ-105(c): the provenance record must name the producer version READ AT GENERATION
    // TIME (0.32.0 / commit 1c59d74 per the 04-tests.md TASK-103 execution record) — encoded as
    // the version-agnostic shape so the next re-mirror never needs a test edit. Markdown bold /
    // backtick decorations around the semver and the sha are tolerated. 0.30.0 may survive only
    // as a historical spec-time mention; this test deliberately does NOT require (or forbid) it.
    expect(section,
      'the [Unreleased] provenance must lead with the generation-time recorded producer, shaped "regenerated against plugin <semver> (commit <sha>)"')
      .toMatch(/regenerated against (?:the )?(?:installed )?plugin\s+\*{0,2}v?\d+\.\d+\.\d+\*{0,2}\s+\(commit\s+`?[0-9a-f]{7,40}`?\)/i)
    expect(section, 'the regeneration command must be auditable').toContain('generate-orky-contract-fixtures')
  })
})

describe('ESC-001 descent — amended REQ-107 prose-phrasing scan + new REQ-113 doc pin', () => {
  it("TEST-720 REQ-107 (amended, scan 4): every 'intake…human' prose compression of the pre-v2 phase_order tail in CLAUDE.md and the two provenance sites either continues '-review' or is explicitly labeled historical — in particular CLAUDE.md's line ~179 parenthetical no longer reads '(intake…human)'", () => {
    // TASK-117's scope: CLAUDE.md (the FINDING-005/012 must-fix site) plus the REQ-107 provenance
    // sites. Historical artifacts (CHANGELOG past entries, .orky/features/*, docs/superpowers/*)
    // stay exempt per the spec — never read here. Scans (1)–(3) remain review-time greps
    // (TASK-109/TASK-122); this frozen assertion is scan (4) only.
    const files = ['CLAUDE.md', 'src/shared/orky-status.ts', 'docs/features/orky-status.md']
    const historical = /historical|pre-?v2|resolved (?:as of|at|by) (?:contract )?v2|contract v2/i
    for (const rel of files) {
      const src = fileRaw(rel)
      const scan = /intake.{1,5}human/g // `.` never crosses a newline — single-line compressions only
      let m: RegExpExecArray | null
      while ((m = scan.exec(src)) !== null) {
        const end = m.index + m[0].length
        const continuesReview = src.slice(end, end + '-review'.length) === '-review'
        // ±200 chars of context: an explicitly-historical label must sit in the same passage
        const context = src.slice(Math.max(0, m.index - 200), Math.min(src.length, end + 200))
        const line = src.slice(0, m.index).split('\n').length
        expect(continuesReview || historical.test(context),
          `${rel}:${line} — prose mirror ${JSON.stringify(m[0])} of the pre-v2 phase_order tail must continue "-review" or be explicitly labeled historical/pre-v2 (amended REQ-107 scan 4)`)
          .toBe(true)
      }
    }
  })

  it('TEST-721 REQ-113: docs/features/orky-pane.md documents the v2 resolution display — all three OrkyFindingDetail field names in the registry:detail payload description, plus a passage naming the affix, BOTH display guards, and the row-title mirror', () => {
    const doc = fileRaw('docs/features/orky-pane.md')
    for (const field of ['`resolution`', '`resolvedBy`', '`resolvedAt`']) {
      expect(doc, `the registry:detail payload description must name ${field}`).toContain(field)
    }
    // the affix passage — anchored on the affix label itself (CONV-032 anchor: TASK-121 writes one
    // contiguous section; both guards and the tooltip mirror must be described within ±2000 chars
    // of the `— resolution:` mention, so unrelated "non-empty" prose elsewhere in the doc — e.g.
    // the escalation-answer passage — never satisfies these pins by accident)
    const at = doc.search(/—\s?resolution:/)
    expect(at, 'the doc must describe the `— resolution:` finding-row affix').toBeGreaterThanOrEqual(0)
    const passage = doc.slice(Math.max(0, at - 2000), at + 2000)
    expect(passage, 'guard 1: the case-insensitive resolved-status check must be named').toMatch(/case-?insensitiv/i)
    expect(passage, 'guard 2: the non-empty-resolution display guard must be named').toMatch(/non-?empty/i)
    expect(passage, 'the clipped-row full-text mirror via the row title/tooltip must be described').toMatch(/title|tooltip/i)
  })
})
