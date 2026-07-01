// FROZEN doc-drift guard — feature 0005-cross-project-orky-registry (phase 4 / REQ-023, doc-sync gate).
// REQ-023 requires: a feature doc under docs/features/ (extending orky-status.md OR a new
// orky-registry.md — either location is acceptable per the spec's resolved decision), a CLAUDE.md
// "Where things live" reference, a CHANGELOG [Unreleased] entry, and `.orky/baseline/architecture.md`
// reconciled to name the new app-wide `OrkyRegistry` service + the new `orky-registry.json` persisted
// file. Mirrors tests/docs-feature-0004.test.ts. Runs RED until the docs are reconciled (doc-sync phase).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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

/** REQ-023 accepts EITHER an extended docs/features/orky-status.md OR a new docs/features/orky-registry.md
 *  — the spec leaves the exact location to the implementer (D1 forward-note + plan target-file-layout
 *  lists both as acceptable). */
function registryDocContent(): string {
  const candidates = ['docs/features/orky-registry.md', 'docs/features/orky-status.md']
  const existing = candidates.find(c => existsSync(resolve(process.cwd(), c)))
  expect(existing, 'expected a registry-describing doc at docs/features/orky-registry.md or an extended docs/features/orky-status.md').toBeTruthy()
  return fileLower(existing!)
}

describe('TEST-146 REQ-023 docs traceability — feature 0005 cross-project Orky registry', () => {
  it('a feature doc describes the cross-project registry service + the registry:* channels + orky-registry.json', () => {
    const doc = registryDocContent()
    expect(doc).toContain('registry')
    expect(doc).toContain('registry:status')
    expect(doc).toContain('orky-registry.json')
  })

  it('CLAUDE.md references the registry feature (Where things live, or the orky-status gotcha paragraph)', () => {
    const claude = fileLower('claude.md')
    expect(claude).toContain('orky-registry')
  })

  it('CHANGELOG Unreleased records the cross-project registry feature', () => {
    const s = unreleasedSection()
    expect(s).toContain('registry')
  })

  it('.orky/baseline/architecture.md names the new OrkyRegistry service + the orky-registry.json persisted file', () => {
    const arch = fileLower('.orky/baseline/architecture.md')
    expect(arch).toContain('orkyregistry')
    expect(arch).toContain('orky-registry.json')
  })
})
