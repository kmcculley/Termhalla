// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-009/010/012/013/018 as amended per D4′/D6′/FINDING-014/FINDING-017).
// The client-side pure units: the daemon-flow launch-command builder (now carrying the
// workspace-scope `--ws=<token>`, REQ-009), the TERMHALLA_BRIDGE_V1 status-line parser (now with
// `daemonProto`), the deterministic workspace-token derivation (REQ-013/REQ-018), and the
// extended connect classification — the exit-96 fatal row (REQ-010) and the
// daemon-PROTOCOL-drift truth table (REQ-012: drift keys on wire-protocol incompatibility ONLY;
// an app-version difference no longer classifies as drift at all — it establishes). These
// strings are a wire contract three ways (frozen unit pins here, the fake-ssh shim parses them,
// a real Linux login shell executes them) — the F19 precedent.
//
// Chosen contract (frozen here):
//   src/remote-client/ssh-command.ts additively exports
//     buildDaemonAgentLaunchCommand(installPath, ptyBackend, wsToken) — token gate
//     ^[A-Za-z0-9_-]{1,64}$ (it is interpolated into a remote shell command AND a filesystem
//     path: the charset gate is the injection/traversal guard).
//   src/remote-client/ws-token.ts exports deriveWsToken(workspaceId) — a conforming id is used
//     as-is; a non-conforming id maps deterministically into the charset.
//   src/remote-client/bridge-status.ts exports parseBridgeStatus(stderrText) →
//     { spawned: boolean; daemonVersion: string | null; daemonProto: number | null;
//       daemonPid: number | null } | null   (tolerant: missing/malformed ⇒ null, NEVER a throw;
//     the parse input is the RAW newline-preserving stderr — FINDING-017).
//   src/remote-client/classify.ts additively exports classifyDaemonConnectOutcome(
//     ConnectObservation & { bridgeStatus, expectedVersion, expectedProto, wsToken }) adding the
//     { kind: 'daemon-protocol-drift'; diagnostic } row.
import { describe, it, expect } from 'vitest'
import { buildDaemonAgentLaunchCommand, buildAgentLaunchCommand } from '../src/remote-client/ssh-command'
import { deriveWsToken } from '../src/remote-client/ws-token'
import { parseBridgeStatus } from '../src/remote-client/bridge-status'
import { classifyDaemonConnectOutcome } from '../src/remote-client/classify'

const PATH_123 = '~/.termhalla/agent/termhalla-agent-1.2.3.cjs'
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

describe('TEST-2417 REQ-009 the daemon-flow launch command is pinned (with --ws); the F19 shape is untouched', () => {
  it('pins the exact daemon-flow command for both backends', () => {
    expect(buildDaemonAgentLaunchCommand(PATH_123, 'fake', 'ws-a1')).toBe(
      `test -f ${PATH_123} && exec node ${PATH_123} --attach --pty=fake --ws=ws-a1 || exit 127`
    )
    expect(buildDaemonAgentLaunchCommand(PATH_123, 'node-pty', 'W_9')).toBe(
      `test -f ${PATH_123} && exec node ${PATH_123} --attach --pty=node-pty --ws=W_9 || exit 127`
    )
  })

  it('rejects unsafe paths, foreign backends, and out-of-charset tokens with specific errors (CONV-001)', () => {
    expect(() => buildDaemonAgentLaunchCommand('/tmp/a b.cjs', 'fake', 'w')).toThrow(/installPath/)
    expect(() => buildDaemonAgentLaunchCommand("/tmp/a'b.cjs", 'fake', 'w')).toThrow(/installPath/)
    expect(() => buildDaemonAgentLaunchCommand('/tmp/../etc/agent.cjs', 'fake', 'w')).toThrow(/installPath/)
    expect(() => buildDaemonAgentLaunchCommand(PATH_123, 'bash' as never, 'w')).toThrow(/ptyBackend/)
    // The token enters a remote shell command AND a filesystem path — the charset gate is the
    // injection/traversal guard (REQ-009).
    for (const bad of ['', 'a b', "a'b", '../evil', 'a/b', 'a;b', 'x'.repeat(65)]) {
      expect(() => buildDaemonAgentLaunchCommand(PATH_123, 'fake', bad), `token ${JSON.stringify(bad)}`)
        .toThrow(/wsToken/)
    }
  })

  it('the existing two-argument F19 builder stays byte-identical (strictly additive, REQ-009)', () => {
    expect(buildAgentLaunchCommand(PATH_123, 'fake')).toBe(
      `test -f ${PATH_123} && exec node ${PATH_123} --pty=fake || exit 127`
    )
  })
})

describe('TEST-2450 REQ-013/REQ-018 deterministic workspace-token derivation', () => {
  it('a conforming workspace id is used as-is (same workspace ⇒ same token on every reconnect)', () => {
    expect(deriveWsToken('ws-main_01')).toBe('ws-main_01')
    const sixtyFour = 'k'.repeat(64)
    expect(deriveWsToken(sixtyFour)).toBe(sixtyFour)
  })

  it('a non-conforming id maps deterministically INTO the charset — repeat-stable, never a throw', () => {
    for (const raw of ['C:\\dev\\my project!', 'späces & ünicode', 'a/b/c', '', 'x'.repeat(65)]) {
      const t1 = deriveWsToken(raw)
      expect(t1, `token for ${JSON.stringify(raw)} conforms`).toMatch(TOKEN_RE)
      expect(deriveWsToken(raw), 'derivation is deterministic (reconnect-stable)').toBe(t1)
    }
  })

  it('distinct workspace ids yield distinct tokens (same-host coexistence, REQ-018)', () => {
    const seen = new Set<string>()
    for (const id of ['ws-a', 'ws-b', 'C:\\dev\\alpha', 'C:\\dev\\beta', 'x'.repeat(65), 'y'.repeat(65)]) {
      seen.add(deriveWsToken(id))
    }
    expect(seen.size, 'no two distinct workspaces may share a daemon/socket').toBe(6)
  })
})

describe('TEST-2418 REQ-009 the bridge status line parses tolerantly (4-field shape) and never throws', () => {
  it('parses the fresh-spawn and attach-to-existing shapes, with daemonProto', () => {
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 {"spawned":true,"daemonVersion":"1.2.3","daemonProto":1,"daemonPid":4711}'))
      .toEqual({ spawned: true, daemonVersion: '1.2.3', daemonProto: 1, daemonPid: 4711 })
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 {"spawned":false,"daemonVersion":null,"daemonProto":null,"daemonPid":null}'))
      .toEqual({ spawned: false, daemonVersion: null, daemonProto: null, daemonPid: null })
  })

  it('finds the line inside multi-line free-form bridge stderr — diagnostics BEFORE and after it (FINDING-017)', () => {
    // The raw, line-structure-preserving view is the parse input: e.g. the REQ-011
    // backend-mismatch diagnostic legitimately precedes the status line.
    const stderr = [
      'bridge: attaching to a daemon running backend "fake" while --pty=node-pty was requested',
      'TERMHALLA_BRIDGE_V1 {"spawned":false,"daemonVersion":"9.9.9","daemonProto":2,"daemonPid":7}',
      'bridge: piping'
    ].join('\n')
    expect(parseBridgeStatus(stderr)).toEqual({ spawned: false, daemonVersion: '9.9.9', daemonProto: 2, daemonPid: 7 })
  })

  it('missing / malformed / mistyped / field-incomplete lines yield null — never a throw', () => {
    expect(parseBridgeStatus('')).toBeNull()
    expect(parseBridgeStatus('plain diagnostics only\nno sentinel here')).toBeNull()
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 not-json{{{')).toBeNull()
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 {"spawned":"yes","daemonVersion":1,"daemonProto":"x","daemonPid":"x"}')).toBeNull()
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 {}')).toBeNull()
    // The pre-revision-2 THREE-field shape is not the Definitions contract — malformed ⇒ null.
    expect(parseBridgeStatus('TERMHALLA_BRIDGE_V1 {"spawned":true,"daemonVersion":"1.2.3","daemonPid":4711}')).toBeNull()
  })
})

// ── the protocol-drift truth table (REQ-012, locked D4′) ─────────────────────────────────────
const base = {
  sawAnyFrame: true,
  exitCode: null as number | null,
  stderrExcerpt: '',
  expectedVersion: '1.2.3',
  expectedProto: 7,
  wsToken: 'wsdrift'
}

describe('TEST-2419 REQ-012 (proto-mismatch, spawned:false) is daemon-protocol-drift — fatal, honest, non-destructive', () => {
  it('names both proto/version pairs, the ws-keyed metadata file, and BOTH recovery paths; states the sessions run on', () => {
    const r = classifyDaemonConnectOutcome({
      ...base,
      handshakeFailureKind: 'proto-mismatch',
      bridgeStatus: { spawned: false, daemonVersion: '0.9.9-old', daemonProto: 9, daemonPid: 4711 }
    })
    expect(r.kind).toBe('daemon-protocol-drift')
    if (r.kind !== 'daemon-protocol-drift') return
    expect(r.diagnostic, 'names the client\'s app version').toContain('1.2.3')
    expect(r.diagnostic, 'names the client\'s proto').toContain('7')
    expect(r.diagnostic, 'names the daemon\'s app version from the status line').toContain('0.9.9-old')
    expect(r.diagnostic, 'names the daemon\'s proto from the status line').toContain('9')
    expect(r.diagnostic, 'points at the WORKSPACE-KEYED metadata file — the manual escape hatch')
      .toContain('daemon-wsdrift.json')
    expect(r.diagnostic, 'recovery path 1: the daemon idles out on its own').toMatch(/idle/i)
    expect(r.diagnostic, 'recovery path 2: manually terminate the recorded pid').toMatch(/pid/i)
    expect(r.diagnostic, 'states the live sessions keep running unharmed (CONV-054 discipline)')
      .toMatch(/session/i)
    expect(r.diagnostic).toMatch(/running|unharmed|continue/i)
  })

  it('an app-version difference alone is NOT drift — the relaxed handshake never fails on it (D4′)', () => {
    // Under the daemon flow, a version-mismatch failure kind can no longer be produced; if a
    // caller ever feeds one, it must NOT classify as protocol drift.
    const r = classifyDaemonConnectOutcome({
      ...base,
      handshakeFailureKind: 'version-mismatch',
      bridgeStatus: { spawned: false, daemonVersion: '0.9.9-old', daemonProto: 7, daemonPid: 4711 }
    })
    expect(r.kind, 'FINDING-014: routine app updates must never surface as drift').not.toBe('daemon-protocol-drift')
  })
})

describe('TEST-2420 REQ-012 the other drift rows: fresh-spawn mismatch falls through; unreadable never throws', () => {
  it('(proto-mismatch, spawned:true) is the F19 provisionable row, unchanged (a torn/wrong artifact)', () => {
    const r = classifyDaemonConnectOutcome({
      ...base,
      handshakeFailureKind: 'proto-mismatch',
      bridgeStatus: { spawned: true, daemonVersion: '1.2.3', daemonProto: 9, daemonPid: 99 }
    })
    expect(r.kind, 're-uploading the client\'s own artifact is the correct remedy there').toBe('version-mismatch')
  })

  it('(proto-mismatch, status unreadable) is drift with an unknown-daemon-protocol/version wording', () => {
    const r = classifyDaemonConnectOutcome({
      ...base,
      handshakeFailureKind: 'proto-mismatch',
      bridgeStatus: null
    })
    expect(r.kind).toBe('daemon-protocol-drift')
    if (r.kind !== 'daemon-protocol-drift') return
    expect(r.diagnostic).toContain('1.2.3')
    expect(r.diagnostic).toMatch(/unknown/i)
  })
})

describe('TEST-2421 REQ-010 the bridge exit taxonomy rows in the classifier', () => {
  it('a zero-frame exit-96 launch is fatal and carries the sanitized bridge stderr excerpt', () => {
    const r = classifyDaemonConnectOutcome({
      ...base,
      handshakeFailureKind: undefined,
      sawAnyFrame: false,
      exitCode: 96,
      stderrExcerpt: 'bridge: could not reach a listening daemon at ~/.termhalla/agent/agent-wsdrift.sock',
      bridgeStatus: null
    })
    expect(r.kind).toBe('fatal')
    if (r.kind === 'fatal') expect(r.diagnostic).toContain('agent-wsdrift.sock')
  })

  it('a zero-frame exit-127 stays absent (the unchanged F19 row) and other exits stay fatal', () => {
    const absent = classifyDaemonConnectOutcome({
      ...base, handshakeFailureKind: undefined, sawAnyFrame: false, exitCode: 127, bridgeStatus: null
    })
    expect(absent.kind).toBe('absent')

    const usage = classifyDaemonConnectOutcome({
      ...base, handshakeFailureKind: undefined, sawAnyFrame: false, exitCode: 2,
      stderrExcerpt: 'usage: ...', bridgeStatus: null
    })
    expect(usage.kind).toBe('fatal')
  })
})
