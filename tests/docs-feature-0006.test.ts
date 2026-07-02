// FROZEN doc-drift guard — feature 0006-decision-queue-panel (phase 4 / REQ-018, doc-sync gate).
// REQ-018 requires: a feature doc under docs/features/, a CLAUDE.md "Where things live" reference,
// a CHANGELOG [Unreleased] entry, the new toggle-orky-queue command wherever keybindings are
// documented, and every stale "the registry aggregate has no renderer consumer" claim reconciled
// (ipc-contract.ts's own comment and `.orky/baseline/architecture.md` — CONV-008).
// Mirrors tests/docs-feature-0005.test.ts / -0007. Runs RED until doc-sync reconciles the docs.
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

describe('TEST-364 REQ-018 docs traceability — feature 0006 decision-queue panel', () => {
  it('a feature doc describes the drawer, its data path, membership/ordering, and the read-only scope', () => {
    const doc = fileLower('docs/features/decision-queue.md')
    expect(doc).toContain('registry:status')
    expect(doc).toContain('registrycurrent')            // the one recovery pull
    expect(doc).toMatch(/generation/)                    // the push-vs-pull arbitration
    expect(doc).toContain('toggle-orky-queue')
    expect(doc).toMatch(/needshuman|needs-human|needs a human/)
    expect(doc).toMatch(/read-only|read only/)
  })

  it('CLAUDE.md references the decision-queue feature (Where things live)', () => {
    expect(fileLower('claude.md')).toContain('decision-queue')
  })

  it('CHANGELOG Unreleased records the decision-queue drawer', () => {
    expect(unreleasedSection()).toMatch(/decision[- ]queue/)
  })

  it('the keybindings doc records the new toggle-orky-queue command', () => {
    expect(fileLower('docs/features/keybindings.md')).toContain('toggle-orky-queue')
  })

  it('no remaining doc/comment claims the registry aggregate has no renderer consumer (CONV-008)', () => {
    // F5's ipc-contract comment: "IPC/data-only, no renderer UI consumes this …" — now false.
    expect(fileLower('src/shared/ipc-contract.ts')).not.toContain('no renderer ui consumes this')
    // F5's baseline architecture line: "… this feature ships no renderer UI." must be reconciled to
    // note registry:status now HAS a renderer consumer (this feature).
    const arch = fileLower('.orky/baseline/architecture.md')
    expect(arch).not.toMatch(/ships\s+no renderer ui\./)
    expect(arch).toMatch(/decision[- ]queue/)
  })
})
