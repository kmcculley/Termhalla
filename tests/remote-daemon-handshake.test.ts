// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — REQ-012/REQ-014, locked
// D4′ per FINDING-014).
// The ADDITIVE daemon-flow handshake variant in the @shared/remote protocol barrel: it
// establishes on WIRE-PROTOCOL compatibility ONLY (a peer `proto` within DAEMON_PROTO_COMPAT);
// the app-version string is advisory — a routine auto-update (app version bumps, proto
// unchanged) reattaches. The exact-version machines are UNTOUCHED (their frozen F15 suites pass
// with zero edits; the behavioral anti-regression pin below proves the relaxation is a NEW
// export, not a change to the old one).
//
// Chosen contract (frozen here): src/shared/remote/protocol.ts additionally re-exports
//   createDaemonAgentHandshake({ version, capabilities })   (hello proto = WIRE_PROTO)
//   createDaemonClientHandshake({ version })
//   DAEMON_PROTO_COMPAT: readonly number[]                  (v1: exactly [WIRE_PROTO]; MUST be
//                                                            derived from WIRE_PROTO — the
//                                                            TEST-2455 drift rig transforms only
//                                                            handshake.ts's WIRE_PROTO literal)
// A proto outside the range fails with reason 'proto-mismatch' and a message naming BOTH protos
// AND BOTH app versions (REQ-012's acceptance).
import { describe, it, expect } from 'vitest'
import {
  createDaemonAgentHandshake, createDaemonClientHandshake, DAEMON_PROTO_COMPAT,
  createClientHandshake, WIRE_PROTO, AGENT_V1_CAPABILITIES
} from '@shared/remote/protocol'
import type { HelloFrame } from '@shared/remote/protocol'

const agentHello = (version: string): HelloFrame =>
  createDaemonAgentHandshake({ version, capabilities: AGENT_V1_CAPABILITIES }).helloFrame()

describe('TEST-2451 REQ-012/REQ-014 the relaxed daemon-flow handshake: protocol-range acceptance, version advisory', () => {
  it('DAEMON_PROTO_COMPAT is v1-exactly the current wire proto (the RANGE machinery is the contract)', () => {
    expect([...DAEMON_PROTO_COMPAT]).toEqual([WIRE_PROTO])
  })

  it('the daemon-side hello carries WIRE_PROTO, role agent, and the advertised (advisory) version', () => {
    const hello = agentHello('0.9.9-old-daemon')
    expect(hello.type).toBe('hello')
    expect(hello.proto).toBe(WIRE_PROTO)
    expect(hello.role).toBe('agent')
    expect(hello.version).toBe('0.9.9-old-daemon')
  })

  it('same proto + DIFFERENT app-version strings establish in BOTH directions (the auto-update flow)', () => {
    // Client side: a newer client meets an older daemon's hello.
    const client = createDaemonClientHandshake({ version: '1.2.3-new-client' })
    const cr = client.onMessage(agentHello('0.9.9-old-daemon'))
    expect(cr.ok, 'an app-version difference alone MUST NOT fail the daemon-flow handshake (D4′)').toBe(true)
    if (cr.ok) {
      expect(cr.reply.type).toBe('hello')
      expect(cr.reply.role).toBe('client')
      expect(cr.reply.proto).toBe(WIRE_PROTO)
      expect(cr.capabilities.length, 'capabilities pass through as usual').toBeGreaterThan(0)
    }

    // Agent side: the daemon accepts the version-drifted client reply.
    const agent = createDaemonAgentHandshake({ version: '0.9.9-old-daemon', capabilities: AGENT_V1_CAPABILITIES })
    const ar = agent.onMessage({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '1.2.3-new-client' })
    expect(ar.ok, 'the daemon likewise establishes on protocol compatibility only').toBe(true)
  })

  it('a proto OUTSIDE the compatible range fails with proto-mismatch naming both protos and both app versions', () => {
    const client = createDaemonClientHandshake({ version: '1.2.3-new-client' })
    const foreign = { ...agentHello('9.9.9-future-daemon'), proto: 99 }
    const r = client.onMessage(foreign)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.reason).toBe('proto-mismatch')
      expect(r.failure.message, 'names the peer proto').toContain('99')
      expect(r.failure.message, 'names the local proto').toContain(String(WIRE_PROTO))
      expect(r.failure.message, 'names the peer app version (diagnostics)').toContain('9.9.9-future-daemon')
      expect(r.failure.message, 'names the local app version (diagnostics)').toContain('1.2.3-new-client')
    }

    const agent = createDaemonAgentHandshake({ version: '1.0.0', capabilities: AGENT_V1_CAPABILITIES })
    const ar = agent.onMessage({ type: 'hello', proto: 42, role: 'client', version: '2.0.0' })
    expect(ar.ok).toBe(false)
    if (!ar.ok) expect(ar.failure.reason).toBe('proto-mismatch')
  })

  it('non-hello and wrong-role openers still fail (the relaxation loosened ONLY the version check)', () => {
    const client = createDaemonClientHandshake({ version: '1.0.0' })
    const bad = client.onMessage({ type: 'req', id: 1, method: 'pty:sessions', params: null })
    expect(bad.ok).toBe(false)

    const wrongRole = createDaemonClientHandshake({ version: '1.0.0' })
      .onMessage({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '1.0.0' })
    expect(wrongRole.ok, 'a client hello is not an agent hello').toBe(false)
  })

  it('the EXACT-VERSION machine still rejects an app-version difference (additive, never a replacement — REQ-014)', () => {
    const strict = createClientHandshake({ version: '1.2.3-new-client' })
    const r = strict.onMessage(agentHello('0.9.9-old-daemon'))
    expect(r.ok, 'the default stdio flow keeps the exact-version check (REQ-001/REQ-012)').toBe(false)
    if (!r.ok) expect(r.failure.reason).toBe('version-mismatch')
  })
})
