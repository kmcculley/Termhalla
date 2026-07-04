// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// The pure connect-failure classification (REQ-011): provisionable (absent / version-mismatch)
// vs fatal — the truth table F19's whole provisioning policy hangs on, unit-tested without
// processes.
import { describe, it, expect } from 'vitest'
import { classifyConnectOutcome } from '../src/remote-client/classify'

const base = { sawAnyFrame: false, exitCode: null as number | null, stderrExcerpt: '' }

describe('TEST-2018 REQ-011 classification truth table', () => {
  it('exit 127 with zero frames → absent (provisionable)', () => {
    expect(classifyConnectOutcome({ ...base, exitCode: 127 }).kind).toBe('absent')
  })

  it('handshake version-mismatch → version-mismatch (provisionable)', () => {
    expect(classifyConnectOutcome({ ...base, sawAnyFrame: true, handshakeFailureKind: 'version-mismatch' }).kind)
      .toBe('version-mismatch')
  })

  it('ssh transport failure (255) → fatal, diagnostic carries the stderr excerpt and the code', () => {
    const r = classifyConnectOutcome({ ...base, exitCode: 255, stderrExcerpt: 'permission denied, please try again' })
    expect(r.kind).toBe('fatal')
    expect(r.kind === 'fatal' ? r.diagnostic : '').toMatch(/permission denied/i)
    expect(r.kind === 'fatal' ? r.diagnostic : '').toMatch(/255/)
  })

  it('every other handshake failure kind → fatal, never provisionable', () => {
    for (const kind of ['proto-mismatch', 'bad-hello', 'unexpected-frame', 'bad-json', 'frame-too-large']) {
      const r = classifyConnectOutcome({ ...base, sawAnyFrame: true, handshakeFailureKind: kind })
      expect(r.kind, `handshake failure "${kind}" must be fatal`).toBe('fatal')
      expect(r.kind === 'fatal' ? r.diagnostic : '', 'the diagnostic names the failure kind (CONV-001)')
        .toContain(kind)
    }
  })

  it('exit 127 AFTER frames were seen → fatal (the artifact ran; 127 came from something else)', () => {
    expect(classifyConnectOutcome({ ...base, sawAnyFrame: true, exitCode: 127 }).kind).toBe('fatal')
  })

  it('an unexpected clean or nonzero exit with no hello → fatal with the exit code in the diagnostic', () => {
    for (const code of [0, 1, 2]) {
      const r = classifyConnectOutcome({ ...base, exitCode: code })
      expect(r.kind).toBe('fatal')
      expect(r.kind === 'fatal' ? r.diagnostic : '').toContain(String(code))
    }
  })
})
