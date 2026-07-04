// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// Pure units: CLI arg parsing (REQ-011) and strict method-param validation (REQ-009, REQ-007
// shapes). Failure modes per CONV-001/CONV-002: coded, named, actionable.
import { describe, it, expect } from 'vitest'
import { parseAgentArgs } from '../src/agent/args'
import {
  validateSpawnParams, validateWriteParams, validateResizeParams, validateKillParams
} from '../src/agent/validate'

describe('TEST-759 REQ-011 CLI args: --pty selection and usage errors', () => {
  it('defaults to node-pty, accepts fake, rejects unknown values and flags with usage', () => {
    expect(parseAgentArgs([])).toEqual({ ok: true, ptyBackend: 'node-pty' })
    expect(parseAgentArgs(['--pty=node-pty'])).toEqual({ ok: true, ptyBackend: 'node-pty' })
    expect(parseAgentArgs(['--pty=fake'])).toEqual({ ok: true, ptyBackend: 'fake' })

    const bogus = parseAgentArgs(['--pty=bogus'])
    expect(bogus.ok).toBe(false)
    if (!bogus.ok) {
      expect(bogus.usage).toContain('bogus')
      expect(bogus.usage).toContain('--pty')
    }
    const unknown = parseAgentArgs(['--nope'])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.usage).toContain('--nope')
  })
})

const goodSpawn = { id: 'p1', shellId: 'default', cwd: '/home/u', cols: 80, rows: 24 }

describe('TEST-760 REQ-009 spawn param validation is strict, coded, and names the offender', () => {
  it('accepts the canonical shape and rejects each malformation naming the key', () => {
    const ok = validateSpawnParams(goodSpawn)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.args).toEqual(goodSpawn)

    const cases: Array<[unknown, string]> = [
      [null, 'params'],
      ['nope', 'params'],
      [{ ...goodSpawn, id: undefined }, 'id'],
      [{ ...goodSpawn, id: '' }, 'id'],
      [{ ...goodSpawn, cwd: undefined }, 'cwd'],
      [{ ...goodSpawn, cols: 0 }, 'cols'],
      [{ ...goodSpawn, cols: -8 }, 'cols'],
      [{ ...goodSpawn, rows: 1.5 }, 'rows'],
      [{ ...goodSpawn, rows: '24' }, 'rows'],
      [{ ...goodSpawn, shellId: 7 }, 'shellId'],
      [{ ...goodSpawn, foo: 1 }, 'foo']
    ]
    for (const [params, offender] of cases) {
      const r = validateSpawnParams(params)
      expect(r.ok, `must reject ${JSON.stringify(params)}`).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('bad-params')
        expect(r.message).toContain(offender)
      }
    }
  })

  it('rejects the local-only launch/envId fields as unsupported in v1, by name', () => {
    for (const field of ['launch', 'envId'] as const) {
      const r = validateSpawnParams({ ...goodSpawn, [field]: field === 'launch' ? { command: 'x' } : 'e1' })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('bad-params')
        expect(r.message).toContain(field)
        expect(r.message.toLowerCase()).toContain('unsupported')
      }
    }
  })
})

describe('TEST-761 REQ-009 write/resize/kill param validation', () => {
  it('validates write: id + data strings, required keys, no extras', () => {
    expect(validateWriteParams({ id: 'p1', data: 'ls\n' }).ok).toBe(true)
    for (const [params, offender] of [
      [null, 'params'], [{ id: 'p1' }, 'data'], [{ id: '', data: 'x' }, 'id'],
      [{ id: 'p1', data: 7 }, 'data'], [{ id: 'p1', data: 'x', extra: 1 }, 'extra']
    ] as Array<[unknown, string]>) {
      const r = validateWriteParams(params)
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.code).toBe('bad-params'); expect(r.message).toContain(offender) }
    }
  })

  it('validates resize: positive integer cols/rows, never clamped (CONV-003)', () => {
    expect(validateResizeParams({ id: 'p1', cols: 1, rows: 1 }).ok).toBe(true)
    for (const [params, offender] of [
      [{ id: 'p1', cols: -1, rows: 5 }, 'cols'], [{ id: 'p1', cols: 5, rows: 0 }, 'rows'],
      [{ id: 'p1', cols: 2.5, rows: 5 }, 'cols'], [{ id: 'p1', cols: 5 }, 'rows']
    ] as Array<[unknown, string]>) {
      const r = validateResizeParams(params)
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.code).toBe('bad-params'); expect(r.message).toContain(offender) }
    }
  })

  it('validates kill: the bare pane-id string (mirroring TermhallaApi.ptyKill)', () => {
    const ok = validateKillParams('p1')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.id).toBe('p1')
    for (const bad of ['', 7, null, { id: 'p1' }]) {
      const r = validateKillParams(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('bad-params')
    }
  })
})
