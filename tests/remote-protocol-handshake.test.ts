// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// The connect handshake: agent speaks first, two-message establishment, EXACT-version
// check (locked decision 2: version-locked client/agent — a version CHECK, never a
// compatibility matrix). Covers REQ-008 (sequence + state machines), REQ-009 (exact
// string-identity version comparison), and parts of REQ-013/REQ-015.
import { describe, it, expect } from 'vitest'
import {
  createAgentHandshake,
  createClientHandshake,
  parseWireMessage,
  WIRE_PROTO,
  ProtocolError,
  type WireFrame
} from '@shared/remote/protocol'

const caught = (fn: () => unknown): ProtocolError => {
  try { fn() } catch (e) { return e as ProtocolError }
  throw new Error('expected the call to throw, but it returned')
}

describe('TEST-738 REQ-008 happy path: agent hello → client reply → both established', () => {
  it('walks the full two-message establishment with capabilities surfaced sorted', () => {
    const agent = createAgentHandshake({ version: '1.2.3', capabilities: ['status', 'pty'] })
    const hello = agent.helloFrame()
    // the agent hello is a valid wire message carrying exactly what it was given
    const parsed = parseWireMessage(hello)
    expect(parsed.ok).toBe(true)
    expect(hello.type).toBe('hello')
    expect(hello.role).toBe('agent')
    expect(hello.proto).toBe(WIRE_PROTO)
    expect(hello.version).toBe('1.2.3')

    const client = createClientHandshake({ version: '1.2.3' })
    const r = client.onMessage(hello)
    expect(r.done).toBe(true)
    if (!r.done || !r.ok) throw new Error('client handshake should have succeeded')
    // capabilities are exposed SORTED ascending regardless of wire order
    expect(r.capabilities).toEqual(['pty', 'status'])
    // the reply is exactly the client hello — proto, role, version, and NO capabilities key
    expect(r.reply).toEqual({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '1.2.3' })
    expect(parseWireMessage(r.reply).ok).toBe(true)

    const a = agent.onMessage(r.reply)
    expect(a.done).toBe(true)
    if (!a.done) throw new Error('unreachable')
    expect(a.ok).toBe(true)
  })
})

describe('TEST-739 REQ-008 failure vectors and the single-use contract', () => {
  const agentHello: WireFrame = {
    type: 'hello', proto: WIRE_PROTO, role: 'agent', version: '1.0.0', capabilities: ['pty', 'status']
  }

  it('a non-hello frame before establishment fails with unexpected-frame, naming the received type', () => {
    const client = createClientHandshake({ version: '1.0.0' })
    const r = client.onMessage({ type: 'req', id: 1, method: 'pty:spawn', params: null })
    expect(r.done).toBe(true)
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('unexpected-frame')
    expect(r.failure.message).toContain('req')
    expect('reply' in r).toBe(false)

    const agent = createAgentHandshake({ version: '1.0.0', capabilities: ['pty'] })
    const ra = agent.onMessage({ type: 'ack', id: 'p1', bytes: 1 })
    if (!ra.done || ra.ok) throw new Error('should have failed')
    expect(ra.failure.reason).toBe('unexpected-frame')
    expect(ra.failure.message).toContain('ack')
  })

  it('a hello with the wrong role fails with bad-hello', () => {
    const client = createClientHandshake({ version: '1.0.0' })
    // client expected an AGENT hello; a client-role hello is bad
    const r = client.onMessage({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '1.0.0' })
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('bad-hello')

    const agent = createAgentHandshake({ version: '1.0.0', capabilities: ['pty'] })
    const ra = agent.onMessage(agentHello) // agent-role hello sent to the agent
    if (!ra.done || ra.ok) throw new Error('should have failed')
    expect(ra.failure.reason).toBe('bad-hello')
  })

  it('a malformed hello (fails REQ-007 validation) is bad-hello', () => {
    const client = createClientHandshake({ version: '1.0.0' })
    const r = client.onMessage({ type: 'hello', proto: WIRE_PROTO, role: 'agent', version: '1.0.0' })
    // agent hello without capabilities is malformed
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('bad-hello')
  })

  it('a foreign proto fails with proto-mismatch (distinct from version-mismatch)', () => {
    const client = createClientHandshake({ version: '1.0.0' })
    const r = client.onMessage({ type: 'hello', proto: 2, role: 'agent', version: '1.0.0', capabilities: ['pty'] })
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('proto-mismatch')
    expect(r.failure.message).toContain('2')
    expect(r.failure.message).toContain(String(WIRE_PROTO))
  })

  it('both machines are single-use: onMessage after done throws handshake-done', () => {
    const client = createClientHandshake({ version: '1.0.0' })
    const ok = client.onMessage(agentHello)
    expect(ok.done).toBe(true)
    const err = caught(() => client.onMessage(agentHello))
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err.reason).toBe('handshake-done')

    const agent = createAgentHandshake({ version: '1.0.0', capabilities: ['pty'] })
    const clientReply: WireFrame = { type: 'hello', proto: WIRE_PROTO, role: 'client', version: '1.0.0' }
    agent.onMessage(clientReply)
    const err2 = caught(() => agent.onMessage(clientReply))
    expect(err2.reason).toBe('handshake-done')
  })

  it('no frame is emitted on failure (failure results carry no reply)', () => {
    const client = createClientHandshake({ version: '9.9.9' })
    const r = client.onMessage(agentHello) // version mismatch
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(Object.prototype.hasOwnProperty.call(r, 'reply')).toBe(false)
  })
})

describe('TEST-740 REQ-009 the version check is EXACT string identity — never a range or normalization', () => {
  const agentHelloWith = (version: string): WireFrame =>
    ({ type: 'hello', proto: WIRE_PROTO, role: 'agent', version, capabilities: ['pty', 'status'] })

  it('identical strings establish', () => {
    const client = createClientHandshake({ version: '0.11.0' })
    const r = client.onMessage(agentHelloWith('0.11.0'))
    expect(r.done && r.ok).toBe(true)
  })

  it.each([
    ['0.11.1'],
    ['v0.11.0'],
    ['0.11.0 '],
    ['0.11.0-beta']
  ])('near-miss %j fails with version-mismatch carrying BOTH versions verbatim', (agentVersion) => {
    const client = createClientHandshake({ version: '0.11.0' })
    const r = client.onMessage(agentHelloWith(agentVersion))
    expect(r.done).toBe(true)
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('version-mismatch')
    expect(r.failure.message).toContain('0.11.0')
    expect(r.failure.message).toContain(agentVersion)
    const detailText = JSON.stringify(r.failure.detail)
    expect(detailText).toContain('0.11.0')
    expect(detailText).toContain(JSON.stringify(agentVersion).slice(1, -1))
  })

  it('the agent side applies the same exact check to the client hello', () => {
    const agent = createAgentHandshake({ version: '0.11.0', capabilities: ['pty'] })
    const r = agent.onMessage({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '0.11.1' })
    expect(r.done).toBe(true)
    if (!r.done || r.ok) throw new Error('should have failed')
    expect(r.failure.reason).toBe('version-mismatch')
    expect(r.failure.message).toContain('0.11.0')
    expect(r.failure.message).toContain('0.11.1')
  })
})
