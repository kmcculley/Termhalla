// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// The named-agent pure model (REQ-003): seeded from SSH favorites, normalized, no secrets.
import { describe, it, expect } from 'vitest'
import type { SshConnection } from '../src/shared/types'
import { normalizeNamedAgents, seedNamedAgentFromConnection } from '../src/shared/remote-agents'

const favorite: SshConnection = {
  id: 'conn-1',
  name: 'build box',
  host: 'build.example.com',
  user: 'kevin',
  port: 2222,
  identityFile: 'C:/keys/id_ed25519',
  tmuxSession: 'main',
  tmuxOptions: { mouse: true }
}

describe('TEST-2010 REQ-003 seeding a named agent from an SSH favorite', () => {
  it('copies exactly host/user/port/identityFile and never the tmux fields', () => {
    const a = seedNamedAgentFromConnection(favorite, 'agent-1', 'buildbox')
    expect(a.id).toBe('agent-1')
    expect(a.name).toBe('buildbox')
    expect(a.host).toBe('build.example.com')
    expect(a.user).toBe('kevin')
    expect(a.port).toBe(2222)
    expect(a.identityFile).toBe('C:/keys/id_ed25519')
    expect(Object.keys(a as unknown as Record<string, unknown>).sort()).toEqual(
      ['host', 'id', 'identityFile', 'name', 'port', 'user']
    )
  })

  it('omits port/identityFile when the favorite has none', () => {
    const a = seedNamedAgentFromConnection(
      { id: 'c', name: 'n', host: 'h.example', user: 'u' }, 'agent-2', 'plain'
    )
    expect(a.port).toBeUndefined()
    expect(a.identityFile).toBeUndefined()
    expect(a.host).toBe('h.example')
  })
})

describe('TEST-2011 REQ-003 normalizeNamedAgents: strip, drop, never throw (CONV-002)', () => {
  it('strips unknown fields — an injected secret cannot ride along', () => {
    const out = normalizeNamedAgents([
      { id: 'a', name: 'n', host: 'h', user: 'u', password: 'hunter2', privateKey: '-----BEGIN' }
    ])
    expect(out).toHaveLength(1)
    const keys = Object.keys(out[0] as unknown as Record<string, unknown>)
    expect(keys).not.toContain('password')
    expect(keys).not.toContain('privateKey')
    expect(out[0]).toMatchObject({ id: 'a', name: 'n', host: 'h', user: 'u' })
  })

  it('drops records missing id/name/host/user and keeps the valid subset', () => {
    const out = normalizeNamedAgents([
      { id: 'a', name: 'n', host: 'h', user: 'u' },
      { id: 'b', name: 'n' }, // no host/user
      { name: 'n', host: 'h', user: 'u' }, // no id
      null,
      42,
      'nope'
    ])
    expect(out.map((a) => a.id)).toEqual(['a'])
  })

  it('non-array/malformed top-level input yields [] without throwing', () => {
    expect(normalizeNamedAgents(undefined)).toEqual([])
    expect(normalizeNamedAgents(null)).toEqual([])
    expect(normalizeNamedAgents({})).toEqual([])
    expect(normalizeNamedAgents('[]')).toEqual([])
  })

  it('coerces invalid optional fields away instead of keeping garbage', () => {
    const out = normalizeNamedAgents([
      { id: 'a', name: 'n', host: 'h', user: 'u', port: 'not-a-port', identityFile: 7, remoteAgentDir: 9 }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].port).toBeUndefined()
    expect(out[0].identityFile).toBeUndefined()
    expect(out[0].remoteAgentDir).toBeUndefined()
    const out2 = normalizeNamedAgents([{ id: 'a', name: 'n', host: 'h', user: 'u', port: 70000 }])
    expect(out2[0].port, 'an out-of-range port must not survive normalization').toBeUndefined()
  })
})
