// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// REQ-017(b): the feature documentation exists and carries the load-bearing claims.
// Existence + key literals only — doc-sync retains latitude over prose (CONV-008 sweep is
// doc-sync's job; the CLAUDE.md row is deliberately NOT pinned here, CONV-012/CONV-022).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('TEST-778 REQ-017 docs/features/remote-agent.md documents the agent contract', () => {
  it('exists and contains the load-bearing literals', () => {
    const p = resolve(process.cwd(), 'docs/features/remote-agent.md')
    expect(existsSync(p), 'docs/features/remote-agent.md must exist (REQ-017)').toBe(true)
    const doc = readFileSync(p, 'utf8')
    for (const literal of [
      'termhalla-agent.cjs',
      '--pty=fake',
      'version check',
      'pty:spawn',
      'unknown-pane',
      'exit code',
      'F17'
    ]) {
      expect(doc.includes(literal), `remote-agent.md must state: ${literal}`).toBe(true)
    }
  })
})
