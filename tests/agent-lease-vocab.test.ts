// FROZEN test suite — feature 0021-exclusive-attach-lease (phase 4).
// REQ-008: the lease-revocation vocabulary — one additive constant through the established
// two-door pattern; every pinned closed set stays closed (the frozen TEST-749/TEST-750/
// TEST-1908 suites keep guarding the sets themselves; this suite pins the NEW constant).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { CH } from '@shared/ipc-contract'
import {
  AGENT_LEASE_REVOKED_EVT, AGENT_PTY_METHODS, AGENT_SESSION_METHODS
} from '@shared/remote-agent-api'
import { AGENT_LEASE_REVOKED_EVT as agentDoor } from '../src/agent/session-api'

const root = process.cwd()

const walk = (dir: string, exts: string[]): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

describe('TEST-2111 REQ-008 the lease-revocation channel constant', () => {
  it('is exactly "lease:revoked", identical through both doors', () => {
    expect(AGENT_LEASE_REVOKED_EVT).toBe('lease:revoked')
    expect(agentDoor, 'the shared door re-exports the agent-side definition (one binding)').toBe(AGENT_LEASE_REVOKED_EVT)
  })

  it('is disjoint from every pinned method string and every local CH channel', () => {
    expect((AGENT_PTY_METHODS as readonly string[]).includes(AGENT_LEASE_REVOKED_EVT)).toBe(false)
    expect((AGENT_SESSION_METHODS as readonly string[]).includes(AGENT_LEASE_REVOKED_EVT)).toBe(false)
    expect(Object.values(CH).includes(AGENT_LEASE_REVOKED_EVT as never),
      'remote-only: no local CH channel exists for the lease').toBe(false)
  })

  it('the literal appears in exactly one src file: the definition site (two-door discipline)', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(root, 'src'), ['.ts', '.tsx'])) {
      const src = readFileSync(f, 'utf8')
      if (src.includes("'lease:revoked'") || src.includes('"lease:revoked"')) offenders.push(f.replace(/\\/g, '/'))
    }
    expect(offenders.length, `the literal must live only at the definition site, found: ${offenders.join(', ')}`).toBe(1)
    expect(offenders[0].endsWith('src/agent/session-api.ts'), `definition site must be session-api.ts, got ${offenders[0]}`).toBe(true)
  })
})
