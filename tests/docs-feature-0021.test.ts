// FROZEN test suite — feature 0021-exclusive-attach-lease (phase 4).
// REQ-012: the feature documentation carries the load-bearing claims. Existence + key literals
// only — doc-sync retains latitude over prose (the CLAUDE.md/CHANGELOG rows are deliberately
// NOT pinned here, CONV-012/CONV-022).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('TEST-2112 REQ-012 remote-agent.md documents the exclusive attach lease', () => {
  it('exists and contains the load-bearing literals', () => {
    const p = resolve(process.cwd(), 'docs/features/remote-agent.md')
    expect(existsSync(p), 'docs/features/remote-agent.md must exist').toBe(true)
    const doc = readFileSync(p, 'utf8')
    for (const literal of [
      'lease:revoked',
      'attach -d',
      'exactly one',
      'lease'
    ]) {
      expect(doc.includes(literal), `remote-agent.md must state: ${literal}`).toBe(true)
    }
    expect(/steal/i.test(doc), 'remote-agent.md must describe the steal semantics').toBe(true)
  })
})
