// FROZEN integration suite — feature 0012-quick-capture-inbox, REVISION 2 (ESC-001 review-gate
// loopback; phase 4 / TASK-012, REQ-014 — the FINDING-009 repair). Targets
// `src/main/orky/orky-cli-runner.ts`'s error CLASSIFICATION: `timedOut: true` is RESERVED for the
// genuine elapsed-time class (execFile's timeout kill and abort), while a SPAWN-class failure — the
// child never executed, so NOTHING can have been written — must resolve `timedOut: false` and
// surface through the byte-unchanged `mapCliRunToResult` as a DEFINITE `cli-error`/`cli-unparseable`,
// NEVER the indeterminate `cli-timeout` (CONV-015 honesty: "may or may not have been captured" is a
// FALSE claim for a child that never ran).
//
// This file is NEW: `tests/main/orky-cli-runner.test.ts` (TEST-211..217) is FROZEN and stays
// byte-preserved (REQ-014 acceptance 6). Mock/real split per that suite's own precedent: a SMALL
// number of REAL execFile vectors against the tests/fixtures/orky-cli-stubs fixtures, plus ONE
// module-mocked vector for the callback-delivered string-errno shape the real OS boundary cannot
// reach deterministically on every platform.
//
// Empirical ground truth (probed on Windows, Node 24, at design time): an oversized command line
// makes `execFile` THROW SYNCHRONOUSLY (`Error: spawn ENAMETOOLONG`, code:'ENAMETOOLONG',
// syscall:'spawn') — it never reaches the callback — so the SHIPPED runner does not even map it to
// `timedOut:true`: it REJECTS, violating its own documented "NEVER rejects" contract. On Linux the
// same class (E2BIG, >128KB single arg) is delivered via the callback and hits the `:34-35`
// catch-all → `timedOut:true` → the false `cli-timeout`. TEST-507 is RED against both mechanisms;
// the repair must make the runner RESOLVE `{timedOut:false}` for the whole spawn-failure class
// (sync-throw AND callback-delivered) without touching the numeric-exit branch, `unref()`, the
// exported signature, or `mapCliRunToResult` (byte-unchanged per REQ-013).
//
// Runs RED today: TEST-507 (the shipped runner rejects / classifies spawn failure as timeout) and
// TEST-508 (the callback-delivered string-errno shape resolves timedOut:true). TEST-509/510/511 are
// deliberately GREEN retained-behavior pins — they fence the repair so it cannot over-rotate: the
// genuine elapsed-time class and the numeric-exit branch keep their exact current behavior.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolve, join } from 'node:path'
import { runOrkyCli, DEFAULT_CLI_TIMEOUT_MS } from '../../src/main/orky/orky-cli-runner'
import { mapCliRunToResult } from '../../src/shared/orky-action-result'

const STUB_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'orky-cli-stubs')
const CONTROLLED = join(STUB_DIR, 'controlled.js')
const ECHO_ARGV = join(STUB_DIR, 'echo-argv.js')

afterEach(() => { vi.doUnmock('node:child_process'); vi.resetModules() })

describe('runOrkyCli — spawn failure is DEFINITE, never the indeterminate timeout (REQ-014, FINDING-009)', () => {
  it('TEST-507 REQ-014 REQ-010 REAL boundary: a multi-megabyte --json argv element (over every OS command-line limit) RESOLVES (never rejects) with timedOut:false, and the byte-unchanged mapper yields a DEFINITE cli-error/cli-unparseable — NEVER cli-timeout', async () => {
    // The exact class F12 makes renderer-reachable (REQ-010 forbids client caps; the item is ONE
    // JSON argv element): a pathologically large detail. ~8MB clears Windows's ~32,767-char
    // CreateProcess limit AND Linux's per-arg MAX_ARG_STRLEN by orders of magnitude.
    const oversizedItem = JSON.stringify({
      kind: 'work.request',
      title: 'pasted a huge log excerpt',
      detail: 'x'.repeat(8 * 1024 * 1024)
    })
    // NEVER rejects — the never-reject contract must hold for the sync-throw spawn class too.
    const run = await runOrkyCli(ECHO_ARGV, ['submit', '--app', 'C:\\proj', '--json', oversizedItem], {
      timeoutMs: DEFAULT_CLI_TIMEOUT_MS
    })
    // The child NEVER RAN: nothing can have been written, so the verdict must be definite.
    expect(run.timedOut).toBe(false)
    const mapped = mapCliRunToResult('submitWork', 'feedback', run)
    expect(mapped.ok).toBe(false)
    expect(['cli-error', 'cli-unparseable']).toContain(mapped.errorKind)
    expect(mapped.errorKind).not.toBe('cli-timeout')
  })

  it('TEST-508 REQ-014 MOCKED: a callback-delivered string-errno execFile error (E2BIG/ENAMETOOLONG/EINVAL class — the child never ran) resolves timedOut:false and maps to a definite kind, never cli-timeout', async () => {
    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      execFile: (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void
      ) => {
        const err = Object.assign(new Error('spawn E2BIG'), {
          code: 'E2BIG', syscall: 'spawn', killed: false, signal: null
        }) as NodeJS.ErrnoException
        queueMicrotask(() => cb(err, '', ''))
        return { unref() { /* the runner unrefs every child */ } }
      }
    }))
    try {
      const { runOrkyCli: mockedRunOrkyCli } = await import('../../src/main/orky/orky-cli-runner')
      const run = await mockedRunOrkyCli('/fake/feedback/cli.js', ['submit', '--app', 'C:\\proj', '--json', '{}'])
      expect(run.timedOut).toBe(false) // string errno = spawn class = DEFINITE (the child never executed)
      const mapped = mapCliRunToResult('submitWork', 'feedback', run)
      expect(mapped.ok).toBe(false)
      expect(['cli-error', 'cli-unparseable']).toContain(mapped.errorKind)
      expect(mapped.errorKind).not.toBe('cli-timeout')
    } finally {
      vi.doUnmock('node:child_process')
      vi.resetModules()
    }
  })
})

describe('runOrkyCli — the genuine elapsed-time class is UNCHANGED (REQ-014 acceptance 2/3 — deliberately GREEN retained-behavior pins)', () => {
  it('TEST-509 REQ-014 a genuine wall-clock timeout (sleeping child + small timeoutMs) still resolves timedOut:true and maps to cli-timeout — the kind REServed for exactly this class', async () => {
    const control = JSON.stringify({ sleepMs: 5000, stdout: 'never-seen' })
    const run = await runOrkyCli(CONTROLLED, [control], { timeoutMs: 200 })
    expect(run.timedOut).toBe(true)
    expect(run.exitCode).toBeNull()
    const mapped = mapCliRunToResult('submitWork', 'feedback', run)
    expect(mapped.errorKind).toBe('cli-timeout') // INDETERMINATE stays honest: the killed child may have written
  })

  it('TEST-510 REQ-014 an AbortSignal abort keeps its current handling (resolves as the timedOut/indeterminate class, never rejects)', async () => {
    const control = JSON.stringify({ sleepMs: 5000 })
    const controller = new AbortController()
    const p = runOrkyCli(CONTROLLED, [control], { timeoutMs: 10_000, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const run = await p
    expect(run.timedOut).toBe(true)
    expect(run.exitCode).toBeNull()
  })

  it('TEST-511 REQ-014 a numeric-exit CLI error keeps {exitCode:<code>, timedOut:false} byte-preserved and maps to cli-error with the CLI message verbatim', async () => {
    const control = JSON.stringify({ exitCode: 2, stdout: '{"error":"no such escalation"}' })
    const run = await runOrkyCli(CONTROLLED, [control])
    expect(run).toMatchObject({ exitCode: 2, timedOut: false })
    const mapped = mapCliRunToResult('submitWork', 'feedback', run)
    expect(mapped.errorKind).toBe('cli-error')
    expect(mapped.error).toBe('no such escalation')
  })
})
