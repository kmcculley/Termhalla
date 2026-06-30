// FROZEN doc-drift guard — feature 0004-orky-status-awareness (phase 4 / REQ-022).
// REQ-022 requires a feature doc under docs/features/, a CLAUDE.md "Where things live" reference, a
// CHANGELOG [Unreleased] entry, and the new orky:status channel reflected where channels are documented.
// Mirrors tests/docs-feature-0003.test.ts. Runs RED until the docs are reconciled (the feature doc does
// not exist yet → readFileSync throws / the substring assertions fail).
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
    // data-provenance: the hardcoded phase list is a manual data-update follow-up if Orky's pipeline drifts
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
