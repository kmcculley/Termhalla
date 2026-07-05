// FROZEN docs suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-016).
// REQ-020: the living docs tell the F21 truth (the docs-feature-0009 precedent). Doc-sync makes
// these true; the pins define the contract.
//
// Runs RED today: docs/features/remote-workspaces.md does not exist and the cross-references
// have not been updated.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('feature docs (REQ-020)', () => {
  it('TEST-2278 REQ-020 docs/features/remote-workspaces.md exists and covers the core contracts', () => {
    const p = resolve(process.cwd(), 'docs/features/remote-workspaces.md')
    expect(existsSync(p), 'docs/features/remote-workspaces.md must exist').toBe(true)
    const doc = read('docs/features/remote-workspaces.md')
    for (const phrase of [
      'per-workspace home',        // locked decision 7
      'remote-banner',             // the disconnected/connecting overlay contract
      'capabilit',                 // capability greying (capability/capabilities)
      'createClientAckPolicy',     // the F17 consumption contract (fresh per connection)
      'daemon'                     // the v1 no-daemonization consequence (CONV-054)
    ]) {
      expect(doc.toLowerCase()).toContain(phrase.toLowerCase())
    }
  })

  it('TEST-2279 REQ-020 CLAUDE.md gains the where-things-live row for the remote workspace client', () => {
    const claude = read('CLAUDE.md')
    expect(claude).toContain('src/main/remote/')
    expect(claude).toMatch(/remote-workspaces\.md/)
  })

  it('TEST-2280 REQ-020 the upstream follow-up docs record their discharge by this feature', () => {
    // F19's caller-owned-cancellation contract note points at the shipped cancel affordance:
    expect(read('docs/features/remote-bootstrap.md')).toMatch(/shipped in 0022|wired in 0022|landed in 0022/i)
    // The 0018 items routed to F21 (FINDING-004 fresh ids; FINDING-006 cadence/quiet-flush) are annotated:
    const followups = read('docs/superpowers/0018-windowed-flow-control-review-followups.md')
    expect(followups).toMatch(/0022|F21.*(landed|shipped|discharged)|discharged.*(0022|F21)/i)
  })
})
