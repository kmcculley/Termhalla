// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-001 as amended).
// The agent CLI gains --daemon / --attach / --ws= / --socket= / --idle-timeout-ms= as strictly
// ADDITIVE surface. With no mode flag the parse result must stay byte-identical to the shipped
// F16 shape — the frozen TEST-759 pins `toEqual({ ok: true, ptyBackend })` exactly, so every new
// AgentArgs field MUST be absent/undefined for legacy inputs (the collision survey in 02-spec.md).
//
// Chosen contract (frozen here): the ok-shape gains OPTIONAL fields
//   mode?: 'daemon' | 'attach'      (absent = the F16 stdio agent)
//   wsToken?: string                (--ws=<token>, ^[A-Za-z0-9_-]{1,64}$ — the workspace scope)
//   socketPath?: string             (--socket=<path> — named-pipe paths under test, REQ-016)
//   idleTimeoutMs?: number          (--idle-timeout-ms=<n>, positive integer only)
// `--daemon`/`--attach` each REQUIRE a scope (`--ws` or `--socket`); neither present is a usage
// error naming the missing scope. Mutually exclusive mode flags, a malformed --ws token, and a
// non-positive/non-integer idle timeout are usage errors (usage on stderr, exit 2 — the existing
// { ok: false, usage } shape), per CONV-001/CONV-002.
import { describe, it, expect } from 'vitest'
import { parseAgentArgs } from '../src/agent/args'

describe('TEST-2400 REQ-001 legacy inputs parse byte-identically (the TEST-759 compatibility pin)', () => {
  it('no mode flag: exactly the F16 shape, no new fields present', () => {
    // vitest toEqual ignores undefined-valued properties — these pins therefore also prove the
    // new fields are absent/undefined for legacy argv (TEST-759 stays green with ZERO edits).
    expect(parseAgentArgs([])).toEqual({ ok: true, ptyBackend: 'node-pty' })
    expect(parseAgentArgs(['--pty=fake'])).toEqual({ ok: true, ptyBackend: 'fake' })
    expect(parseAgentArgs(['--pty=node-pty'])).toEqual({ ok: true, ptyBackend: 'node-pty' })
    // Belt and braces: the enumerable key set itself carries nothing new with a defined value.
    const legacy = parseAgentArgs(['--pty=fake']) as Record<string, unknown>
    for (const k of Object.keys(legacy)) {
      if (k === 'ok' || k === 'ptyBackend') continue
      expect(legacy[k], `legacy parse leaked a defined new field "${k}"`).toBeUndefined()
    }
  })
})

describe('TEST-2401 REQ-001 the new flags parse (every mode invocation carries a scope)', () => {
  it('--daemon selects daemon mode, composable with --pty/--ws/--socket/--idle-timeout-ms', () => {
    const r = parseAgentArgs(['--daemon', '--pty=fake', '--ws=ws-main_01', '--socket=/tmp/a.sock', '--idle-timeout-ms=1500'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe('daemon')
    expect(r.ptyBackend).toBe('fake')
    expect(r.wsToken).toBe('ws-main_01')
    expect(r.socketPath).toBe('/tmp/a.sock')
    expect(r.idleTimeoutMs).toBe(1500)
  })

  it('--attach with a --ws scope keeps the other defaults; --ws alone is a valid scope', () => {
    const attach = parseAgentArgs(['--attach', '--ws=w1'])
    expect(attach.ok).toBe(true)
    if (attach.ok) {
      expect(attach.mode).toBe('attach')
      expect(attach.ptyBackend).toBe('node-pty')
      expect(attach.wsToken).toBe('w1')
      expect(attach.socketPath).toBeUndefined()
      expect(attach.idleTimeoutMs).toBeUndefined()
    }
    const daemon = parseAgentArgs(['--daemon', '--ws=w1'])
    expect(daemon.ok).toBe(true)
    if (daemon.ok) expect(daemon.mode).toBe('daemon')
  })

  it('an explicit --socket alone is also a valid scope; a win32 named-pipe path parses verbatim', () => {
    const pipe = '\\\\.\\pipe\\termhalla-test-abc'
    const r = parseAgentArgs(['--attach', `--socket=${pipe}`])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.socketPath).toBe(pipe)
      expect(r.wsToken).toBeUndefined()
    }
  })

  it('boundary tokens parse: 1 char and exactly 64 chars of the allowed charset', () => {
    const one = parseAgentArgs(['--daemon', '--ws=a'])
    expect(one.ok).toBe(true)
    const sixtyFour = 'A9_-'.repeat(16)
    const max = parseAgentArgs(['--daemon', `--ws=${sixtyFour}`])
    expect(max.ok).toBe(true)
    if (max.ok) expect(max.wsToken).toBe(sixtyFour)
  })
})

describe('TEST-2402 REQ-001 usage errors: exit-2 shape, named offenders (CONV-001/CONV-002)', () => {
  it('--daemon --attach is a usage error naming the conflicting flags', () => {
    for (const argv of [['--daemon', '--attach', '--ws=w'], ['--attach', '--daemon', '--ws=w']]) {
      const r = parseAgentArgs(argv)
      expect(r.ok, `${argv.join(' ')} must be rejected`).toBe(false)
      if (!r.ok) {
        expect(r.usage).toContain('--daemon')
        expect(r.usage).toContain('--attach')
      }
    }
  })

  it('a non-positive / non-integer / non-numeric --idle-timeout-ms names the offending value', () => {
    for (const bad of ['0', '-5', 'abc', '1.5', '']) {
      const r = parseAgentArgs([`--idle-timeout-ms=${bad}`, '--daemon', '--ws=w'])
      expect(r.ok, `--idle-timeout-ms=${bad} must be rejected`).toBe(false)
      if (!r.ok) {
        expect(r.usage).toContain('--idle-timeout-ms')
        if (bad.length > 0) expect(r.usage).toContain(bad)
      }
    }
  })

  it('an empty --socket= value and unknown flags stay usage errors', () => {
    const emptySock = parseAgentArgs(['--attach', '--socket='])
    expect(emptySock.ok).toBe(false)
    if (!emptySock.ok) expect(emptySock.usage).toContain('--socket')
    const unknown = parseAgentArgs(['--nope'])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.usage).toContain('--nope')
    const bogusPty = parseAgentArgs(['--daemon', '--ws=w', '--pty=bogus'])
    expect(bogusPty.ok).toBe(false)
    if (!bogusPty.ok) expect(bogusPty.usage).toContain('bogus')
  })
})

describe('TEST-2443 REQ-001 the workspace scope: --ws validation and the mandatory-scope rule', () => {
  it('a mode flag with NO scope (--ws or --socket) is a usage error naming the missing scope', () => {
    for (const argv of [['--daemon'], ['--attach'], ['--daemon', '--pty=fake'], ['--attach', '--idle-timeout-ms=5']]) {
      const r = parseAgentArgs(argv)
      expect(r.ok, `${argv.join(' ')} must be rejected — a scope is required`).toBe(false)
      if (!r.ok) {
        expect(r.usage, 'the usage names the --ws scope').toContain('--ws')
        expect(r.usage, 'the usage names the --socket alternative').toContain('--socket')
      }
    }
  })

  it('a --ws token outside ^[A-Za-z0-9_-]{1,64}$ is a usage error naming the offending token', () => {
    const bad = ['../evil', 'a b', "a'b", 'a/b', 'a.b', 'ü', 'x'.repeat(65)]
    for (const token of bad) {
      const r = parseAgentArgs(['--daemon', `--ws=${token}`])
      expect(r.ok, `--ws=${token} must be rejected (charset gate — injection/traversal guard)`).toBe(false)
      if (!r.ok) {
        expect(r.usage).toContain('--ws')
        expect(r.usage, 'names the offending token (CONV-001)').toContain(token)
      }
    }
  })

  it('an empty --ws= is a usage error too', () => {
    const r = parseAgentArgs(['--daemon', '--ws='])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.usage).toContain('--ws')
  })
})
