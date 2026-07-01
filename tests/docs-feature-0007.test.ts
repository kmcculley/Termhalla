// FROZEN doc-drift guard — feature 0007-orky-action-dispatch (phase 4 / REQ-020, doc-sync gate).
// REQ-020 requires: a feature doc under docs/features/ (e.g. orky-action-dispatch.md), a CLAUDE.md
// "Where things live" reference, a CHANGELOG [Unreleased] entry naming the first write-capable IPC
// surface, and `.orky/baseline/architecture.md` reconciled to note the new write surface (and that it
// only ever submits human verdicts/decisions/work THROUGH Orky's CLIs, never drives the pipeline — D1).
// Mirrors tests/docs-feature-0005.test.ts. Runs RED until doc-sync reconciles the docs.
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

describe('TEST-280 REQ-020 docs traceability — feature 0007 Orky action-dispatch substrate', () => {
  it('a feature doc describes the four actions + the orkyAction:* channels + the ORKY_PLUGIN_DIR resolver + the audit log', () => {
    const doc = fileLower('docs/features/orky-action-dispatch.md')
    expect(doc).toContain('orkyaction:')
    expect(doc).toContain('resolveescalation')
    expect(doc).toContain('submitwork')
    expect(doc).toContain('recordhumangate')
    expect(doc).toContain('drivestatus')
    expect(doc).toContain('orky_plugin_dir')
    expect(doc).toContain('orky-actions.jsonl')
  })

  it('the doc states the D1/REQ-016/REQ-019 scope guard: never drives the pipeline, never writes .orky/ directly', () => {
    const doc = fileLower('docs/features/orky-action-dispatch.md')
    expect(doc).toMatch(/never drives|never drive the pipeline/)
    expect(doc).toMatch(/no direct .*\.orky|never writes.*\.orky/)
  })

  it('CLAUDE.md references the action-dispatch feature (Where things live)', () => {
    expect(fileLower('claude.md')).toContain('orky-action-dispatch')
  })

  it('CHANGELOG Unreleased records the first write-capable IPC surface', () => {
    const s = unreleasedSection()
    expect(s).toContain('orkyaction')
    expect(s).toMatch(/write-capable|write capable/)
  })

  it('.orky/baseline/architecture.md names the new write surface and its CLI-mediated-only constraint', () => {
    const arch = fileLower('.orky/baseline/architecture.md')
    expect(arch).toContain('orkyactiondispatcher')
    expect(arch).toMatch(/never drives|never drive the pipeline/)
  })
})
