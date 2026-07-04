// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// The capability vocabulary and the public barrel surface.
// Covers REQ-010 (closed union = the 17 per-domain IPC registrar names + 'status'),
// REQ-011 (AGENT_V1_CAPABILITIES), REQ-013 (the barrel exports exactly the spec'd surface).
//
// CONV-022 AMENDMENT PATH for the CAPABILITY_IDS derivation pin below: the registrar
// file set (src/main/ipc/register-*.ts) is a shared, legitimately-evolving surface. A
// future feature that adds a per-domain registrar MUST extend CAPABILITY_IDS in
// src/shared/remote/capabilities.ts AND this test's derivation expectation in the SAME
// change, through that feature's own tests phase — this pin is the mechanical
// enforcement that the capability partition stays in sync with the registrar set
// (locked decision 6), not a freeze against legitimate registrar growth.
//
// The 'status' entry is the ONE non-registrar id: the status domain (pty:status /
// pty:cwd / pty:procs + src/main/status/) locally rides register-pty.ts but is its own
// advertised agent domain per locked decision 6 ("v1 agent = pty + status only") — see
// REQ-010's reconciliation note in the feature spec.
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as protocol from '@shared/remote/protocol'
import {
  CAPABILITY_IDS,
  AGENT_V1_CAPABILITIES,
  isCapabilityId,
  parseWireMessage,
  WIRE_PROTO
} from '@shared/remote/protocol'

describe('TEST-741 REQ-010 CAPABILITY_IDS = the per-domain registrar names + status (closed, sorted, unique)', () => {
  it('deep-equals the sorted union of the register-*.ts names and "status"', () => {
    const registrarNames = readdirSync(resolve(process.cwd(), 'src/main/ipc'))
      .filter((f) => /^register-.+\.ts$/.test(f))
      .map((f) => f.replace(/^register-/, '').replace(/\.ts$/, ''))
    expect(registrarNames.length).toBe(17)
    const expected = [...registrarNames, 'status'].sort()
    expect([...CAPABILITY_IDS]).toEqual(expected)
    expect(CAPABILITY_IDS.length).toBe(18)
  })
  it('is sorted ascending and duplicate-free', () => {
    expect([...CAPABILITY_IDS]).toEqual([...CAPABILITY_IDS].sort())
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length)
  })
  it('isCapabilityId accepts every member and rejects near-misses', () => {
    for (const id of CAPABILITY_IDS) expect(isCapabilityId(id)).toBe(true)
    expect(isCapabilityId('STATUS')).toBe(false)
    expect(isCapabilityId('')).toBe(false)
    expect(isCapabilityId('ptyx')).toBe(false)
    expect(isCapabilityId(42)).toBe(false)
    expect(isCapabilityId(null)).toBe(false)
  })
})

describe('TEST-742 REQ-011 the v1 agent advertisement constant', () => {
  it('AGENT_V1_CAPABILITIES is exactly [pty, status] (locked decision 6: tmux parity)', () => {
    expect([...AGENT_V1_CAPABILITIES]).toEqual(['pty', 'status'])
  })
  it('every entry is a valid capability id', () => {
    for (const id of AGENT_V1_CAPABILITIES) expect(isCapabilityId(id)).toBe(true)
  })
  it('an agent hello built with it passes wire validation', () => {
    const r = parseWireMessage({
      type: 'hello',
      proto: WIRE_PROTO,
      role: 'agent',
      version: '0.11.0',
      capabilities: [...AGENT_V1_CAPABILITIES]
    })
    expect(r.ok).toBe(true)
  })
})

describe('TEST-747 REQ-013 the barrel exports exactly the spec public interface (scope-creep pin)', () => {
  it('the runtime export surface of @shared/remote/protocol is exactly the spec list', () => {
    expect(Object.keys(protocol).sort()).toEqual([
      'AGENT_V1_CAPABILITIES',
      'CAPABILITY_IDS',
      'DEFAULT_MAX_FRAME_BYTES',
      'FRAME_HEADER_BYTES',
      'ProtocolError',
      'WIRE_PROTO',
      'createAgentHandshake',
      'createClientHandshake',
      'createFrameDecoder',
      'createRequestTracker',
      'encodeFrame',
      'isCapabilityId',
      'parseWireMessage'
    ])
  })
})
