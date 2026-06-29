// TEST-021 — REQ-009 documentation traceability guard for feature 0001-edit-menu-settings-toasts.
// REQ-009 is a documentation requirement (the CHANGELOG and docs must record this user-facing change).
// This is a real regression guard, not a no-op: it fails if the Unreleased CHANGELOG section stops
// documenting the Edit-menu move or the toast-notifications default-off behavior, so the doc requirement
// is traceable to an executable check rather than relying on review alone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function unreleasedSection(): string {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  // The Unreleased block runs until the next released-version heading.
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).toLowerCase()
}

describe('TEST-021 REQ-009 docs traceability — feature 0001', () => {
  const section = unreleasedSection()

  it('CHANGELOG Unreleased documents Settings moving to the Edit menu', () => {
    expect(section).toContain('edit')
    expect(section).toContain('settings')
    expect(section).toContain('menu:open-settings')
  })

  it('CHANGELOG Unreleased documents the toast default-off behavior with errors always shown', () => {
    expect(section).toContain('toast')
    expect(section).toMatch(/default off|defaults? off|default-off|default to off/)
    expect(section).toContain('error')
  })
})
