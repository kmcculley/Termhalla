// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-013: the feature documentation carries the load-bearing claims. Existence + key literals
// only — doc-sync retains latitude over prose (the CLAUDE.md row is deliberately NOT pinned
// here, CONV-012/CONV-022).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('TEST-1912 REQ-013 remote-agent.md documents session survival + replay', () => {
  it('exists and contains the load-bearing literals', () => {
    const p = resolve(process.cwd(), 'docs/features/remote-agent.md')
    expect(existsSync(p), 'docs/features/remote-agent.md must exist').toBe(true)
    const doc = readFileSync(p, 'utf8')
    for (const literal of [
      'pty:attach',
      'pty:sessions',
      'HISTORY_LIMIT_DEFAULT',
      '2000',
      'history-limit',
      'transit',
      'F20',
      'snapshot'
    ]) {
      expect(doc.includes(literal), `remote-agent.md must state: ${literal}`).toBe(true)
    }
  })
})
