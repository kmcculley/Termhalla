// FROZEN integration suite — feature 0007-orky-action-dispatch (phase 4 / TASK-004, REQ-010/REQ-011).
// Targets `src/main/orky/orky-cli-runner.ts` — the abortable/unref()'d execFile wrapper, mirroring
// `src/main/cloud/probe.ts`'s `runCliProbe` (see tests/main/cloud-status-service.test.ts's
// "passes an abort signal ... aborts it on stop" sibling test for the pattern this mirrors).
//
// Per the coordinator's guidance, a SMALL number of tests here exercise the REAL `execFile` wiring against
// a tiny stub `.js` CLI fixture (tests/fixtures/orky-cli-stubs/) rather than a fake — proving the actual
// child-process/timeout/argv-array contract end-to-end. The bulk of the dispatcher-level suite
// (tests/main/orky-action-dispatcher.test.ts) injects a FAKE `runCli` instead (no real spawns there).
//
// Chosen contract:
//   export const DEFAULT_CLI_TIMEOUT_MS: number   // re-exported from src/shared/orky-action-result.ts (same value)
//   runOrkyCli(cliPath: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }):
//     Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }>
//   Internally: execFile(process.execPath, [cliPath, ...args], { timeout, windowsHide:true, maxBuffer, signal }),
//   child.unref() immediately after spawn, argument ARRAY only (never shell:true / string concatenation).
//   NEVER rejects — always resolves, even on timeout/abort/spawn error.
//
// Runs RED today: `src/main/orky/orky-cli-runner.ts` does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runOrkyCli, DEFAULT_CLI_TIMEOUT_MS } from '../../src/main/orky/orky-cli-runner'

const STUB_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'orky-cli-stubs')
const CONTROLLED = join(STUB_DIR, 'controlled.js')
const ECHO_ARGV = join(STUB_DIR, 'echo-argv.js')

describe('runOrkyCli — real child process, clean exits (REQ-011)', () => {
  it('TEST-211 REQ-011 a stub exiting 0 with JSON stdout resolves {exitCode:0, stdout:<json>, timedOut:false}', async () => {
    const control = JSON.stringify({ exitCode: 0, stdout: '{"ok":true,"mode":"file"}' })
    const r = await runOrkyCli(CONTROLLED, [control])
    expect(r).toEqual({ exitCode: 0, stdout: '{"ok":true,"mode":"file"}', timedOut: false })
  })

  it('TEST-212 REQ-011 a stub exiting 2 with an error-JSON body resolves {exitCode:2, stdout:<json>, timedOut:false} (never rejects on a nonzero exit)', async () => {
    const control = JSON.stringify({ exitCode: 2, stdout: '{"error":"no such escalation"}' })
    const r = await runOrkyCli(CONTROLLED, [control])
    expect(r.exitCode).toBe(2)
    expect(r.timedOut).toBe(false)
    expect(r.stdout).toContain('no such escalation')
  })
})

describe('runOrkyCli — timeout resolves rather than hangs/rejects (REQ-010)', () => {
  it('TEST-213 REQ-010 a stub that sleeps past timeoutMs resolves {exitCode:null, timedOut:true} within ~timeout+eps, never rejects and never waits for the sleep to finish', async () => {
    const control = JSON.stringify({ sleepMs: 5000, stdout: 'never-seen' })
    const t0 = Date.now()
    const r = await runOrkyCli(CONTROLLED, [control], { timeoutMs: 200 })
    const elapsed = Date.now() - t0
    expect(r.exitCode).toBeNull()
    expect(r.timedOut).toBe(true)
    expect(elapsed).toBeLessThan(4000) // resolved via the timeout, not by waiting out the 5s sleep
  })

  it('TEST-214 REQ-010 aborting an in-flight call via AbortSignal resolves as timedOut rather than rejecting/hanging', async () => {
    const control = JSON.stringify({ sleepMs: 5000 })
    const controller = new AbortController()
    const p = runOrkyCli(CONTROLLED, [control], { timeoutMs: 10_000, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const r = await p
    expect(r.timedOut).toBe(true)
    expect(r.exitCode).toBeNull()
  })
})

describe('runOrkyCli — injection-safe argument array (REQ-010)', () => {
  it('TEST-215 REQ-010 args are passed as a literal ARGV array — shell metacharacters in an arg are never interpreted', async () => {
    const dangerous = '$(rm -rf /); echo pwned & whoami'
    const r = await runOrkyCli(ECHO_ARGV, ['--payload', dangerous])
    expect(r.exitCode).toBe(0)
    const echoed = JSON.parse(r.stdout) as string[]
    expect(echoed).toEqual(['--payload', dangerous]) // preserved byte-for-byte as ONE argv element
  })
})

describe('runOrkyCli — structural: execFile with an array, never shell:true; child is unref()\'d (REQ-010)', () => {
  it('TEST-216 REQ-010 source uses execFile(...) with an argv array, never sets shell:true, and calls child.unref()', () => {
    const src = readFileSync(resolve(process.cwd(), 'src', 'main', 'orky', 'orky-cli-runner.ts'), 'utf8')
    expect(src).toMatch(/execFile\(/)
    expect(src).not.toMatch(/shell:\s*true/)
    expect(src).toMatch(/\.unref\(\)/)
  })

  it('TEST-217 REQ-010 DEFAULT_CLI_TIMEOUT_MS is a positive, sane default (imported from the shared result-mapping module, single source of truth)', () => {
    expect(DEFAULT_CLI_TIMEOUT_MS).toBeGreaterThan(0)
    expect(DEFAULT_CLI_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
  })
})
