// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-006).
// Targets `src/shared/orky-action-result.ts` — the pure, TOTAL exit-code + stdout-JSON -> OrkyActionResult
// core (REQ-002/REQ-010/REQ-011). No fs/IPC/clock access (TASK-006 constraint) — this file also owns the
// single shared `DEFAULT_CLI_TIMEOUT_MS` constant (15s) so the timeout message can be formatted without a
// shared->main import (`orky-cli-runner.ts`, TASK-004, imports it FROM here rather than redefining it).
//
// Chosen contract (this suite freezes it):
//   export const DEFAULT_CLI_TIMEOUT_MS = 15_000
//   type CliRun = { exitCode: number | null; stdout: string; timedOut: boolean }
//   type DispatchAction = 'resolveEscalation' | 'submitWork' | 'recordHumanGate' | 'driveStatus'
//   type CliKind = 'feedback' | 'gatekeeper'
//   mapCliRunToResult(action: DispatchAction, cliKind: CliKind, run: CliRun): Partial<OrkyActionResult>
//
// Evaluation order (per TASK-006 prose, pinned): timedOut check FIRST, then JSON-parse-of-stdout (a plain
// object only — array/primitive/empty/garbage all reject), THEN the per-(cliKind,action) exit-code table.
// The CLI's own `{error}` field, when present in parsed JSON, is surfaced VERBATIM (CONV-001) — never
// re-worded. Any undocumented exit code is a defensive `cli-error` branch — this function is TOTAL.
//
// Runs RED today: `src/shared/orky-action-result.ts` does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import { mapCliRunToResult, DEFAULT_CLI_TIMEOUT_MS } from '../../src/shared/orky-action-result'

describe('mapCliRunToResult — timeout (REQ-010) always wins, resolves rather than throwing', () => {
  it('TEST-178 REQ-010 timedOut:true maps to cli-timeout with exitCode:null and a message naming the CLI kind + duration', () => {
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: null, stdout: '', timedOut: true })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBeNull()
    expect(r.errorKind).toBe('cli-timeout')
    expect(r.error).toContain('gatekeeper')
    expect(r.error).toContain('timed out')
    expect(r.error).toContain(String(DEFAULT_CLI_TIMEOUT_MS / 1000))
  })

  it('TEST-179 REQ-010 timedOut:true takes priority even when stdout happens to contain valid JSON', () => {
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 0, stdout: '{"passed":true}', timedOut: true })
    expect(r.errorKind).toBe('cli-timeout')
  })
})

describe('mapCliRunToResult — stdout JSON parsing (REQ-011)', () => {
  it('TEST-180 REQ-011 empty stdout maps to cli-unparseable noting 0 bytes', () => {
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 0, stdout: '', timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-unparseable')
    expect(r.error).toContain('0 bytes')
  })

  it('TEST-181 REQ-011 non-JSON garbage stdout maps to cli-unparseable noting its byte length', () => {
    const stdout = 'not json at all'
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 0, stdout, timedOut: false })
    expect(r.errorKind).toBe('cli-unparseable')
    expect(r.error).toContain(String(stdout.length))
  })

  it('TEST-182 REQ-011 valid JSON that is NOT a plain object (an array) is still cli-unparseable, never accepted as data', () => {
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 0, stdout: '[1,2,3]', timedOut: false })
    expect(r.errorKind).toBe('cli-unparseable')
  })

  it('TEST-183 REQ-011 valid JSON `null` is cli-unparseable, never treated as a successful empty object', () => {
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 0, stdout: 'null', timedOut: false })
    expect(r.errorKind).toBe('cli-unparseable')
  })
})

describe('mapCliRunToResult — feedback emit (always exit 0; REQ-006/REQ-007 layer on top of ok:true)', () => {
  it('TEST-184 REQ-011 exit 0 with parseable JSON -> ok:true, exitCode:0, data is the parsed object verbatim', () => {
    const parsed = { ok: true, mode: 'file', event: 'evt-1', sent: true, spooled: false }
    const r = mapCliRunToResult('resolveEscalation', 'feedback', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r).toMatchObject({ ok: true, exitCode: 0, data: parsed })
  })

  it('TEST-185 REQ-011 an UNDOCUMENTED non-zero exit from feedback is still handled TOTALLY as a defensive cli-error, never an unhandled branch', () => {
    const r = mapCliRunToResult('submitWork', 'feedback', { exitCode: 1, stdout: '{"error":"boom"}', timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toContain('boom') // CONV-001: the CLI's own message surfaces verbatim when present
  })
})

describe('mapCliRunToResult — gatekeeper record: exit 0/1 both ok:true, exit 2 cli-error (REQ-008/REQ-011)', () => {
  it('TEST-186 REQ-011 exit 0 (recorded pass) -> ok:true, data.passed === true', () => {
    const parsed = { passed: true, at: '2026-06-30T00:00:00.000Z', evidence: null, external: true }
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r.ok).toBe(true)
    expect((r.data as { passed: boolean }).passed).toBe(true)
  })

  it('TEST-187 REQ-011 exit 1 (recorded FAIL) -> STILL ok:true (not an error), data.passed === false', () => {
    const parsed = { passed: false, at: '2026-06-30T00:00:00.000Z', evidence: null, external: true }
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 1, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r.ok).toBe(true)
    expect(r.exitCode).toBe(1)
    expect((r.data as { passed: boolean }).passed).toBe(false)
  })

  it('TEST-188 REQ-011 exit 2 with a CLI-supplied {error} -> ok:false, cli-error, message surfaces the CLI text verbatim', () => {
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 2, stdout: JSON.stringify({ error: 'gate not allowed' }), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toBe('gate not allowed')
  })

  it('TEST-189 REQ-011 exit 2 with NO {error} field falls back to a specific default message (never a bare "error")', () => {
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 2, stdout: JSON.stringify({}), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error!.toLowerCase()).not.toBe('error')
    expect(r.error).toMatch(/gatekeeper record/i)
  })

  it('TEST-190 REQ-011 an undocumented exit 5 is a defensive, TOTAL cli-error branch naming the exit code', () => {
    const r = mapCliRunToResult('recordHumanGate', 'gatekeeper', { exitCode: 5, stdout: JSON.stringify({}), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toContain('5')
  })
})

describe('mapCliRunToResult — gatekeeper resolve-escalation fallback / drive: exit 0 ok, exit 2 cli-error (REQ-006/REQ-009/REQ-011)', () => {
  it('TEST-191 REQ-011 resolveEscalation fallback exit 0 -> ok:true, data is the escalation object', () => {
    const parsed = { id: 'ESC-1', resolved: true, decision: 'approve' }
    const r = mapCliRunToResult('resolveEscalation', 'gatekeeper', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r).toMatchObject({ ok: true, exitCode: 0, data: parsed })
  })

  it('TEST-192 REQ-011 resolveEscalation fallback exit 2 (unknown escalation id) -> cli-error carrying the CLI message', () => {
    const r = mapCliRunToResult('resolveEscalation', 'gatekeeper', { exitCode: 2, stdout: JSON.stringify({ error: 'no such escalation ESC-999' }), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toBe('no such escalation ESC-999')
  })

  it('TEST-193 REQ-009/REQ-011 driveStatus exit 0 -> ok:true, data is the raw drive next-action object, passed through unmodified', () => {
    const parsed = { next: 'await-human', reason: 'human-review pending' }
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r).toMatchObject({ ok: true, data: parsed })
  })

  it('TEST-194 REQ-011 driveStatus exit 2 -> cli-error', () => {
    const r = mapCliRunToResult('driveStatus', 'gatekeeper', { exitCode: 2, stdout: JSON.stringify({ error: 'no such feature' }), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toBe('no such feature')
  })
})

describe('mapCliRunToResult — total coverage across every documented (cliKind, action, exitCode) branch', () => {
  it('TEST-195 REQ-011 every branch of the spec\'s exit-code table returns a fully-formed OrkyActionResult fragment (ok + errorKind|data present as appropriate)', () => {
    const cases: Array<{ action: 'resolveEscalation' | 'submitWork' | 'recordHumanGate' | 'driveStatus'; cliKind: 'feedback' | 'gatekeeper'; exitCode: number; expectOk: boolean }> = [
      { action: 'resolveEscalation', cliKind: 'feedback', exitCode: 0, expectOk: true },
      { action: 'submitWork', cliKind: 'feedback', exitCode: 0, expectOk: true },
      { action: 'resolveEscalation', cliKind: 'gatekeeper', exitCode: 0, expectOk: true },
      { action: 'resolveEscalation', cliKind: 'gatekeeper', exitCode: 2, expectOk: false },
      { action: 'recordHumanGate', cliKind: 'gatekeeper', exitCode: 0, expectOk: true },
      { action: 'recordHumanGate', cliKind: 'gatekeeper', exitCode: 1, expectOk: true },
      { action: 'recordHumanGate', cliKind: 'gatekeeper', exitCode: 2, expectOk: false },
      { action: 'driveStatus', cliKind: 'gatekeeper', exitCode: 0, expectOk: true },
      { action: 'driveStatus', cliKind: 'gatekeeper', exitCode: 2, expectOk: false }
    ]
    for (const c of cases) {
      const stdout = JSON.stringify({ error: 'x', passed: false })
      const r = mapCliRunToResult(c.action, c.cliKind, { exitCode: c.exitCode, stdout, timedOut: false })
      expect(r.ok, `${c.action}/${c.cliKind}/${c.exitCode}`).toBe(c.expectOk)
      if (r.ok) expect(r.data).toBeDefined()
      else expect(r.errorKind).toBe('cli-error')
    }
  })
})
