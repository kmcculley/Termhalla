// TEST-023 — REQ-019 documentation traceability guard for feature 0003-pane-minimize-restore.
// REQ-019 is a doc-drift requirement: the CHANGELOG + feature docs must record minimize/restore, the
// per-workspace tray, and that maximize view-state is now PERSISTED (no longer transient). Runs RED
// until the docs are reconciled.
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

describe('TEST-023 REQ-019 docs traceability — feature 0003 minimize/restore', () => {
  it('CHANGELOG Unreleased documents minimize/restore + the per-workspace tray', () => {
    const s = unreleasedSection()
    expect(s).toContain('minimize')
    expect(s).toMatch(/restore/)
    expect(s).toContain('tray')
  })

  it('the workspaces feature doc describes minimize/restore + the tray', () => {
    const doc = fileLower('docs/features/workspaces.md')
    expect(doc).toContain('minimize')
    expect(doc).toContain('tray')
  })

  it('CLAUDE.md no longer calls the maximize view-state transient/non-persisted (REQ-008 reconciliation)', () => {
    expect(fileLower('claude.md')).not.toContain('transient (non-persisted)')
  })
})
