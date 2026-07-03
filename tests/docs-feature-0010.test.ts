// FROZEN doc-drift guard — feature 0010-orky-pane-inline-actions (phase 4 — REQ-009's doc half,
// doc-sync gate / TASK-006). REQ-009 names TWO mandatory corrections (verified pin-free at spec
// time, 2026-07-02): docs/features/orky-pane.md:8-9 ("Strictly READ-only: no `.orky/` write, no
// CLI, no `orkyAction:*` call, no registry mutation") and the OrkyPane.tsx:13-14 header ("Strictly
// READ-only (REQ-013): no action affordance, no mutation call") — both FALSIFIED by F10's
// composition and rewritten to the true post-F10 scope: the pane COMPOSES the shared F8 action
// layer and the F12 rooted capture opener while owning no dispatch/capture/CLI/mutation logic of
// its own. Plus the CHANGELOG [Unreleased] entry (mount + pre-targeted inject + the CONV-046
// shared fix — the /pre-?targeted|pre-?selected/ and /conv-046|mode[- ]?flip/ anchors are
// verified ABSENT from today's [Unreleased] section, so the entry pin runs genuinely RED).
//
// Compatibility constraints this suite rides alongside (not re-pinned here): frozen TEST-503
// (docs-feature-0012.test.ts — the repo-wide no-consumer-claim sweep + the 0012 first-consumer
// sentence) and TEST-613/614 (docs-feature-0008.test.ts — the ipc-contract consumer comment must
// keep matching /F10/) MUST stay green through F10's doc updates.
//
// Runs RED until doc-sync reconciles: both read-only claims are still in the tree and the
// CHANGELOG carries no 0010 entry.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function unreleasedSection(): string {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).toLowerCase()
}
const fileRaw = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const fileLower = (rel: string): string => fileRaw(rel).toLowerCase()

describe('TEST-631 REQ-009 docs traceability — feature 0010 pane inline actions (the CONV-008 boundary corrections)', () => {
  it('docs/features/orky-pane.md no longer claims strict read-only and instead states the composed post-F10 scope: the pane composes the shared action layer + the rooted capture opener while owning no dispatch/capture/CLI/mutation logic of its own; no stale future-tense F10 phrasing survives', () => {
    const doc = fileLower('docs/features/orky-pane.md')
    // the mandatory correction (CONV-008 pattern 2 — the read-only CLAIM class)
    expect(doc, 'the strict read-only claim is falsified by F10 and must be retired').not.toMatch(/strictly read-?only/)
    expect(doc).not.toMatch(/no action affordance/)
    expect(doc).not.toMatch(/no mutation call/)
    // the true post-F10 scope, stated positively
    expect(doc).toMatch(/composes/)
    expect(doc).toMatch(/orkyentryactions|shared (f8 )?action/)
    expect(doc).toContain('openorkycapture')
    expect(doc).toMatch(/owns no|of its own/)
    // CONV-008 pattern 1: no stale future tense in the SAME file
    expect(doc).not.toMatch(/f10 will|future call/)
  })

  it('the OrkyPane.tsx header no longer claims "Strictly READ-only … no action affordance, no mutation call" — re-expressed to the TEST-433-amended composed scope, with no stale reserved-empty/future-F10 phrasing left in the file', () => {
    const src = fileRaw('src/renderer/components/OrkyPane.tsx')
    expect(src, 'the header claim is falsified by F10 and must be re-expressed').not.toMatch(/strictly read-?only/i)
    expect(src).not.toMatch(/no action affordance/i)
    expect(src).not.toMatch(/no mutation call/i)
    // the F9-era slot comment ("deliberately EMPTY … F10 injects … here") describes a slot this
    // feature populates — it must not survive the mount (CONV-008 pattern 1's class)
    expect(src).not.toMatch(/deliberately empty/i)
    expect(src).not.toMatch(/F10 will|future call/i)
  })

  it('CHANGELOG [Unreleased] records the pane-inline-actions composition: the per-row mount, the PRE-TARGETED inject, and the CONV-046 mode-flip fix in the shared component', () => {
    const s = unreleasedSection()
    expect(s).toContain('orky pane')
    expect(s).toMatch(/inline/)
    expect(s).toMatch(/inject|capture/)
    // the two F10-specific anchors (verified ABSENT from today's section — genuinely RED):
    // the inject opens capture PRE-TARGETED to the pane's project (D2's honest framing)…
    expect(s).toMatch(/pre-?targeted|pre-?selected/)
    // …and the CONV-046 mode-flip disarm lands in the shared component for both mounts
    expect(s).toMatch(/conv-046|mode[- ]?flip/)
  })
})
