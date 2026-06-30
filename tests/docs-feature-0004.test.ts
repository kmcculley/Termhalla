// FROZEN doc-drift guard — feature 0004-orky-status-awareness (phase 4 / REQ-022 + REQ-029).
// REQ-022 requires a feature doc under docs/features/, a CLAUDE.md "Where things live" reference, a
// CHANGELOG [Unreleased] entry, and the new orky:status channel reflected where channels are documented.
// REQ-029 requires the `ORKY_PHASES` provenance caveat — distinguishing it from Orky's SEPARATE 9-entry
// `PHASE_ORDER` ("Canonical phase order") — at the constant's definition AND in the feature doc.
// Mirrors tests/docs-feature-0003.test.ts. Runs RED until the docs + the source comment are reconciled.
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
const fileLower = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8').toLowerCase()

describe('TEST-032 REQ-022 docs traceability — feature 0004 Orky status awareness', () => {
  it('a feature doc describes the Orky status mirror + the orky:status channel + the provenance note', () => {
    const doc = fileLower('docs/features/orky-status.md')
    expect(doc).toContain('orky')
    expect(doc).toContain('orky:status')
    expect(doc).toContain('orky_phases')
  })

  it('CLAUDE.md references the Orky status feature doc (where-things-live)', () => {
    expect(fileLower('claude.md')).toContain('orky-status')
  })

  it('CHANGELOG Unreleased records the Orky status-awareness feature', () => {
    const s = unreleasedSection()
    expect(s).toContain('orky')
    expect(s).toContain('status')
  })
})

describe('TEST-052 REQ-029 ORKY_PHASES provenance caveat distinguishes Orky\'s separate PHASE_ORDER', () => {
  it('the feature doc cites the EXACT mirrored source and the intake/human exclusion', () => {
    const doc = fileLower('docs/features/orky-status.md')
    // names the exact mirrored source (the gatekeeper's driver phase list + the recorded gate keys),
    // NOT Orky's separate 9-entry "Canonical phase order" constant.
    expect(doc).toContain('driver_work_phases')
    expect(doc).toContain('phase_order')
    // states that `intake` (no gate) and `human` (recorded as the `human-review` gate key) are excluded/renamed
    expect(doc).toContain('intake')
  })

  it('the ORKY_PHASES source comment carries the caveat and does NOT mislabel it "canonical phase order"', () => {
    const src = fileLower('src/shared/orky-status.ts')
    // the local comment MUST NOT call ORKY_PHASES "canonical (pipeline) phase order" — that is the name of
    // Orky's DIFFERENT 9-element list, and a re-sync against it would prepend `intake` (M=9) or rename
    // human-review→human (zeroing gateN's match on the recorded 'human-review' key). FINDING-PROV-001.
    expect(src).not.toContain('canonical pipeline phase order')
    expect(src).not.toContain('canonical phase order')
    // it MUST cite the exact mirrored source and the intake/human distinction
    expect(src).toContain('driver_work_phases')
    expect(src).toContain('intake')
  })
})
