// TEST-024 — REQ-015 documentation traceability guard for feature 0002-pane-toolbar-split-control.
// REQ-015 is a SHOULD doc-drift requirement: the CHANGELOG must record this user-facing restructure.
// This is a real regression guard (not a no-op) — it fails until the Unreleased CHANGELOG section
// documents (a) Record moving to the pane context menu, (b) the unified split button + four-direction
// compass, and (c) before/after insertion in splitPane. It currently runs RED (no such entry yet).
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

describe('TEST-024 REQ-015 docs traceability — feature 0002', () => {
  const section = unreleasedSection()

  it('CHANGELOG Unreleased documents Record moving to the pane context menu', () => {
    expect(section).toContain('record')
    expect(section).toMatch(/context menu|right-click menu/)
  })

  it('CHANGELOG Unreleased documents the unified split button + four-direction compass', () => {
    expect(section).toContain('split')
    expect(section).toContain('compass')
    for (const dir of ['up', 'down', 'left', 'right']) expect(section).toContain(dir)
  })

  it('CHANGELOG Unreleased documents before/after insertion in splitPane', () => {
    expect(section).toContain('before')
    expect(section).toContain('after')
  })
})
