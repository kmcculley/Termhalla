// FROZEN integration suite — feature 0007-orky-action-dispatch (phase 4 / TASK-008). The largest file in
// this feature's suite — drives the REAL `OrkyActionDispatcher` against FAKE injected `runCli`/
// `locateOrkyCli` functions (never a real subprocess here — that is `orky-cli-runner.test.ts`'s job) and
// REAL fixtured `.orky/` trees on disk (mirrors tests/main/orky-registry-service.test.ts's fixture style).
// Covers REQ-001/002/004/005/006/007/008/009/010/011/012/013/014/015/016/019.
//
// Chosen contract (this suite freezes it; see 04-tests.md "Chosen contracts" for the full rationale,
// including the reconciliation of TASK-002 vs TASK-008's `gate` shape/business-rule split):
//   type RunCli = (cliPath: string, args: string[], opts?: {timeoutMs?:number; signal?:AbortSignal}) =>
//     Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }>
//   type LocateOrkyCli = (kind: 'gatekeeper' | 'feedback') => string | null
//   interface OrkyActionDispatcherDeps {
//     registry: { roots(): string[] }
//     auditLog: OrkyActionAuditLog
//     queue: OrkyActionQueue
//     runCli?: RunCli            // default: the real runOrkyCli
//     locateOrkyCli?: LocateOrkyCli  // default: the real locateOrkyCli bound to process.env
//     now?: () => number         // default: Date.now
//   }
//   class OrkyActionDispatcher {
//     constructor(deps: OrkyActionDispatcherDeps)
//     resolveEscalation(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
//     submitWork(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
//     recordHumanGate(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
//     driveStatus(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
//     dispose(): void
//   }
// `windowId` is an OPTIONAL second positional arg (defaults to null) threaded into the audit record — the
// registrar (register-orky-action.ts) passes `e.sender.id`; this suite calls most actions with just `req`
// (per REQ-001's "a harness invokes each handler and receives an OrkyActionResult"), and threads a
// concrete windowId only in the REQ-013 audit-specific tests.
//
// Exact hard-coded CLI argument arrays this suite pins (REQ-016 — hard-coded subcommand literals only,
// never a request-derived string). SUPERSEDED IN PART by feature 0012-quick-capture-inbox REQ-013
// (CONV-019, tests phase — .orky/features/0012-quick-capture-inbox/04-tests.md): submitWork now rides
// the plugin's local-inbox `feedback submit` (v0.28.0+) instead of the outbox-writing `feedback emit`,
// so the hard-coded set is FIVE literals ('submit' joined; 'emit' STAYS — doResolveEscalation's own
// feedback path is untouched). Amended pins: TEST-237/238/293/267 here, TEST-298/300 in the codex file.
//   resolveEscalation (feedback path):  ['emit','--app',projectRoot,'--type','decision','--feature',slug,'--payload',JSON]
//   resolveEscalation (gatekeeper fallback): ['resolve-escalation','--feature',featureDir,'--id',escalationId,'--decision',decision]
//   submitWork:     ['submit','--app',projectRoot,'--json',JSON.stringify({kind:'work.request',title[,detail][,phase][,feature]})]
//   recordHumanGate: ['record','--feature',featureDir,'--gate',gate,'--verdict',verdict,...(evidence?['--evidence',evidence]:[])]  — NEVER '--force'
//   driveStatus:    ['drive','--feature',featureDir]
//
// Runs RED today: `src/main/orky/orky-action-dispatcher.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyActionDispatcher } from '../../src/main/orky/orky-action-dispatcher'
import { OrkyActionAuditLog } from '../../src/main/orky/orky-action-audit'
import { OrkyActionQueue } from '../../src/main/orky/orky-action-queue'

type CliRun = { exitCode: number | null; stdout: string; timedOut: boolean }
type RunCliCall = { cliPath: string; args: string[] }

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-actdisp-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function seedFeature(root: string, slug: string): string {
  const fdir = join(root, '.orky', 'features', slug)
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({ feature: slug, phase: 'implement', gates: {}, escalations: [] }), 'utf8')
  return fdir
}

function tmpUserDataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orky-actdisp-userdata-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function fakeAuditLog(): OrkyActionAuditLog { return { append: vi.fn(async () => {}) } as unknown as OrkyActionAuditLog }

/** Builds a fake `runCli` that records every call and dispatches to a per-subcommand handler (the
 *  subcommand is `args[0]`, e.g. 'emit'/'record'/'resolve-escalation'/'drive'). */
function fakeRunCli(handlers: Record<string, (args: string[]) => CliRun>): { run: (cliPath: string, args: string[], opts?: unknown) => Promise<CliRun>; calls: RunCliCall[] } {
  const calls: RunCliCall[] = []
  const run = async (cliPath: string, args: string[]): Promise<CliRun> => {
    calls.push({ cliPath, args })
    const sub = args[0]
    const handler = handlers[sub]
    if (!handler) throw new Error(`unexpected subcommand: ${sub}`)
    return handler(args)
  }
  return { run, calls }
}

function ok(data: unknown): CliRun { return { exitCode: 0, stdout: JSON.stringify(data), timedOut: false } }
function fail(exitCode: number, error: string): CliRun { return { exitCode, stdout: JSON.stringify({ error }), timedOut: false } }

function makeDispatcher(opts: {
  roots: string[]
  runCli: (cliPath: string, args: string[], o?: unknown) => Promise<CliRun>
  locateOrkyCli?: (kind: 'gatekeeper' | 'feedback') => string | null
  auditLog?: OrkyActionAuditLog
  queue?: OrkyActionQueue
}): OrkyActionDispatcher {
  return new OrkyActionDispatcher({
    registry: { roots: () => opts.roots },
    auditLog: opts.auditLog ?? fakeAuditLog(),
    queue: opts.queue ?? new OrkyActionQueue(),
    runCli: opts.runCli,
    locateOrkyCli: opts.locateOrkyCli ?? (() => '/fake/cli.js')
  })
}

// ---------------------------------------------------------------------------------------------------

describe('OrkyActionDispatcher — root allowlist (REQ-004)', () => {
  it('TEST-229 REQ-004 a projectRoot NOT in registry.roots() is rejected root-not-allowed; no CLI runs', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: ['C:/some/other/tracked/root'], runCli: run })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('root-not-allowed')
    expect(r.dispatched).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('TEST-230 REQ-004 a case/slash-divergent spelling of an ALLOWLISTED root is accepted (normalizeProjectRoot, CONV-010)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ drive: () => ok({ next: 'await-human' }) })
    const divergent = root.toUpperCase().replace(/\\/g, '/')
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.driveStatus({ projectRoot: divergent, feature: 'f1' })
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1) // proceeded past the root check
  })
})

describe('OrkyActionDispatcher — feature-slug confinement, server-side featureDir (REQ-005)', () => {
  it('TEST-231 REQ-005 a malformed slug ("a/b") is rejected invalid-args by the validator layer; no CLI runs', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'a/b', gate: 'brainstorm', verdict: 'pass' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('invalid-args')
    expect(calls).toHaveLength(0)
  })

  it('TEST-232 REQ-005 a well-formed slug for a NON-EXISTENT feature dir returns feature-not-found; no CLI runs', async () => {
    const root = seedProject() // no feature dirs seeded
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'nope', gate: 'brainstorm', verdict: 'pass' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('feature-not-found')
    expect(calls).toHaveLength(0)
  })

  it('TEST-233 REQ-005 a valid slug resolves to the CORRECT absolute featureDir, confined under <root>/.orky/features/', async () => {
    const root = seedProject()
    const fdir = seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(calls[0].args).toEqual(['drive', '--feature', fdir])
  })
})

describe('OrkyActionDispatcher.resolveEscalation — feedback-first, gatekeeper direct fallback (REQ-006)', () => {
  it('TEST-234 REQ-006 a feedback-ENABLED fixture (mode "file") emits and NEVER touches gatekeeper; reports path:feedback', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ emit: () => ok({ ok: true, mode: 'file', event: 'evt-1', sent: true, spooled: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' })
    expect(r).toMatchObject({ ok: true, path: 'feedback', feedback: 'enabled', dispatched: true })
    expect(calls.map(c => c.args[0])).toEqual(['emit'])
    expect(calls[0].args).toEqual(['emit', '--app', root, '--type', 'decision', '--feature', 'f1', '--payload', JSON.stringify({ escalationId: 'ESC-1', decision: 'approve' })])
  })

  it('TEST-235 REQ-006 a feedback-DISABLED fixture (mode "noop") emits THEN falls back to gatekeeper resolve-escalation; reports path:gatekeeper feedback:disabled', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({
      emit: () => ok({ ok: true, mode: 'noop', sent: false, spooled: false }),
      'resolve-escalation': () => ok({ id: 'ESC-1', resolved: true, decision: 'approve' })
    })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' })
    expect(r).toMatchObject({ ok: true, path: 'gatekeeper', feedback: 'disabled', dispatched: true })
    expect(calls.map(c => c.args[0])).toEqual(['emit', 'resolve-escalation'])
    expect(calls[1].args).toEqual(['resolve-escalation', '--feature', join(root, '.orky', 'features', 'f1'), '--id', 'ESC-1', '--decision', 'approve'])
  })

  it('TEST-236 REQ-006 a non-existent escalationId on the fallback path (gatekeeper exit 2) returns cli-error with the CLI\'s own message, path:gatekeeper', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({
      emit: () => ok({ ok: true, mode: 'noop' }),
      'resolve-escalation': () => fail(2, 'no such escalation ESC-999')
    })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-999', decision: 'approve' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.path).toBe('gatekeeper')
    expect(r.error).toBe('no such escalation ESC-999')
  })
})

describe('OrkyActionDispatcher.submitWork — feedback-only, disabled is a DISTINCT non-dispatch failure (REQ-007)', () => {
  // SUPERSEDED (intent preserved) by feature 0012-quick-capture-inbox REQ-013, CONV-019 (recorded in
  // .orky/features/0012-quick-capture-inbox/04-tests.md): submitWork now invokes `feedback submit`
  // (local-inbox injection, plugin v0.28.0+); the enabled fixture models submit's file-mode receipt —
  // the ONLY success shape (the emit-era http/sent/spooled universe is GONE from this action). The
  // guard's intent is unchanged: an enabled channel reports ok:true/dispatched:true via feedback.
  it('TEST-237 REQ-007 a feedback-ENABLED fixture submits and reports dispatched:true, ok:true (0012/REQ-013: submit file-mode receipt)', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => ok({ ok: true, mode: 'file', id: 'IN-abc123', kind: 'work.request', path: 'inbox/IN-abc123.json' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r).toMatchObject({ ok: true, path: 'feedback', feedback: 'enabled', dispatched: true })
  })

  // SUPERSEDED (intent preserved) by feature 0012-quick-capture-inbox REQ-013, CONV-019: `submit` is
  // NOT best-effort like emit — a disabled channel REFUSES loudly (exit 1 + {ok:false, mode:'noop',
  // error}, feedback.js:280-282 / cli.js:88) instead of emit's exit-0 no-op. The guard's intent is
  // unchanged: disabled stays a DISTINCT non-dispatch failure, never a silent success, and NO
  // gatekeeper fallback exists for submitWork.
  it('TEST-238 REQ-007 a feedback-DISABLED fixture (exit 1 + {ok:false, mode:"noop", error}) is a DISTINCT failure — ok:false, feedback-disabled, dispatched:false — NEVER a silent success; NO gatekeeper fallback exists for submitWork (0012/REQ-013: submit refusal shape)', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ submit: () => ({ exitCode: 1, stdout: JSON.stringify({ ok: false, mode: 'noop', error: 'feedback is disabled — the write path requires enable-feedback (an audited decision, ADR-027)' }), timedOut: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r).toMatchObject({ ok: false, path: 'feedback', feedback: 'disabled', dispatched: false, errorKind: 'feedback-disabled' })
    expect(r.error).toBeTruthy()
    expect(calls.map(c => c.args[0])).toEqual(['submit']) // gatekeeper is NEVER called for submitWork
  })

  it('TEST-239 REQ-007/014 a missing/empty title returns invalid-args BEFORE any emit call', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ emit: () => ok({ mode: 'file' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r1 = await d.submitWork({ projectRoot: root })
    const r2 = await d.submitWork({ projectRoot: root, title: '' })
    expect(r1.errorKind).toBe('invalid-args')
    expect(r2.errorKind).toBe('invalid-args')
    expect(calls).toHaveLength(0)
  })
})

describe('OrkyActionDispatcher.recordHumanGate — gate restricted server-side, NEVER --force (REQ-008)', () => {
  it('TEST-240 REQ-008 gate:"spec" returns gate-not-allowed and spawns NO CLI (independent, in addition to, gatekeeper.js\'s own enforcement)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'spec', verdict: 'pass' })
    expect(r.errorKind).toBe('gate-not-allowed')
    expect(calls).toHaveLength(0)
  })

  it('TEST-241 REQ-008 gate:"implement" ALSO returns gate-not-allowed (not just "spec")', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'implement', verdict: 'fail' })
    expect(r.errorKind).toBe('gate-not-allowed')
    expect(calls).toHaveLength(0)
  })

  it('TEST-242 REQ-008 the invocation NEVER includes --force, for an allowed gate + evidence', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'human-review', verdict: 'pass', evidence: 'human said yes' })
    expect(calls[0].args).not.toContain('--force')
    expect(calls[0].args).toEqual(['record', '--feature', join(root, '.orky', 'features', 'f1'), '--gate', 'human-review', '--verdict', 'pass', '--evidence', 'human said yes'])
  })

  it('TEST-243 REQ-008 verdict:"pass" (exit 0) records and returns ok:true with data.passed === true', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({ record: () => ok({ passed: true, at: '2026-06-30T00:00:00.000Z', evidence: null, external: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    expect(r.ok).toBe(true)
    expect((r.data as { passed: boolean }).passed).toBe(true)
  })

  it('TEST-244 REQ-008 verdict:"fail" (CLI exit 1) returns ok:true with data.passed === false — NOT treated as an error', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({ record: () => ({ exitCode: 1, stdout: JSON.stringify({ passed: false, at: '2026-06-30T00:00:00.000Z', evidence: null, external: true }), timedOut: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'fail' })
    expect(r.ok).toBe(true)
    expect((r.data as { passed: boolean }).passed).toBe(false)
  })

  it('TEST-245 REQ-008/014 a malformed verdict ("maybe") returns invalid-args; no CLI runs', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'maybe' })
    expect(r.errorKind).toBe('invalid-args')
    expect(calls).toHaveLength(0)
  })
})

describe('OrkyActionDispatcher.driveStatus — read-only, dispatched:false always (REQ-009)', () => {
  it('TEST-246 REQ-009 returns the raw Gatekeeper drive object with dispatched:false, ok:true', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({ drive: () => ok({ next: 'await-human', reason: 'human-review pending' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.ok).toBe(true)
    expect(r.dispatched).toBe(false)
    expect(r.data).toEqual({ next: 'await-human', reason: 'human-review pending' })
  })

  it('TEST-247 REQ-009 the feature\'s .orky/ tree is BYTE-IDENTICAL before and after the call (read-only)', async () => {
    const root = seedProject()
    const fdir = seedFeature(root, 'f1')
    const statePath = join(fdir, 'state.json')
    const before = readFileSync(statePath, 'utf8')
    const mtimeBefore = statSync(statePath).mtimeMs
    const { run } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(readFileSync(statePath, 'utf8')).toBe(before)
    expect(statSync(statePath).mtimeMs).toBe(mtimeBefore)
  })

  it('TEST-248 REQ-009/004 an un-allowlisted root is rejected root-not-allowed BEFORE the CLI runs', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: ['C:/not/this/one'], runCli: run })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.errorKind).toBe('root-not-allowed')
    expect(calls).toHaveLength(0)
  })
})

describe('OrkyActionDispatcher — timeout/abort never hangs the action promise (REQ-010/REQ-011)', () => {
  it('TEST-249 REQ-010 a timed-out CLI child resolves the action (never hangs/rejects) as cli-timeout', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({ drive: () => ({ exitCode: null, stdout: '', timedOut: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-timeout')
    expect(r.exitCode).toBeNull()
  })

  it('TEST-250 REQ-001 dispose() aborts any in-flight AbortController(s) this instance created; the pending action STILL resolves (never hangs)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    let capturedSignal: AbortSignal | undefined
    // Match runCli's declared param type (o?: unknown) — under strict function types a narrower
    // `{ signal?: AbortSignal }` param isn't assignable — then narrow to read the signal.
    const run = (_cliPath: string, _args: string[], o?: unknown): Promise<CliRun> => {
      const opts = o as { signal?: AbortSignal } | undefined
      capturedSignal = opts?.signal
      return new Promise((resolve) => {
        const onAbort = (): void => resolve({ exitCode: null, stdout: '', timedOut: true })
        opts?.signal?.addEventListener('abort', onAbort)
      })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const pending = d.driveStatus({ projectRoot: root, feature: 'f1' })
    await new Promise(r => setTimeout(r, 20))
    d.dispose()
    const r = await pending
    expect(capturedSignal?.aborted).toBe(true)
    expect(r.errorKind).toBe('cli-timeout')
  })

  it('TEST-251 REQ-011 non-JSON stdout from a real action call maps to cli-unparseable end-to-end (proves the dispatcher actually wires TASK-006\'s mapper, not just a unit test of the mapper alone)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run } = fakeRunCli({ record: () => ({ exitCode: 0, stdout: 'not json', timedOut: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    expect(r.errorKind).toBe('cli-unparseable')
  })
})

describe('OrkyActionDispatcher — Orky CLI location resolution (REQ-012)', () => {
  it('TEST-252 REQ-012 an unresolved feedback CLI fails resolveEscalation/submitWork with orky-cli-not-found; no CLI spawns', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run, locateOrkyCli: (kind) => (kind === 'feedback' ? null : '/fake/gatekeeper/cli.js') })
    const r1 = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'E1', decision: 'y' })
    const r2 = await d.submitWork({ projectRoot: root, title: 't' })
    expect(r1.errorKind).toBe('orky-cli-not-found')
    expect(r2.errorKind).toBe('orky-cli-not-found')
    expect(r1.error).toContain('feedback')
    expect(calls).toHaveLength(0)
  })

  it('TEST-253 REQ-012 an unresolved gatekeeper CLI fails recordHumanGate/driveStatus with orky-cli-not-found; no CLI spawns', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run, locateOrkyCli: (kind) => (kind === 'gatekeeper' ? null : '/fake/feedback/cli.js') })
    const r1 = await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const r2 = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r1.errorKind).toBe('orky-cli-not-found')
    expect(r2.errorKind).toBe('orky-cli-not-found')
    expect(r1.error).toContain('gatekeeper')
    expect(calls).toHaveLength(0)
  })

  it('TEST-254 REQ-012 with NO locateOrkyCli/runCli overrides at all, construction succeeds and the REAL default resolver reports orky-cli-not-found in this test env (ORKY_PLUGIN_DIR unset) — proves the defaults are wired, not just the injected path', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const savedEnv = process.env.ORKY_PLUGIN_DIR
    delete process.env.ORKY_PLUGIN_DIR
    const d = new OrkyActionDispatcher({ registry: { roots: () => [root] }, auditLog: fakeAuditLog(), queue: new OrkyActionQueue() })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.errorKind).toBe('orky-cli-not-found')
    if (savedEnv !== undefined) process.env.ORKY_PLUGIN_DIR = savedEnv
  })
})

describe('OrkyActionDispatcher — append-only audit log, every invocation attributable (REQ-013)', () => {
  it('TEST-255 REQ-013 a REJECTED action (root-not-allowed) appends one audit line with the attributable fields', async () => {
    const root = seedProject()
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({})
    const d = makeDispatcher({ roots: ['C:/elsewhere'], runCli: run, auditLog })
    await d.driveStatus({ projectRoot: root, feature: 'f1' }, 9)
    const lines = readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'driveStatus', windowId: 9, ok: false, errorKind: 'root-not-allowed', dispatched: false })
    expect(lines[0].projectRoot).toBe(root)
    expect(typeof lines[0].ts).toBe('number')
  })

  it('TEST-256 REQ-013 an ACCEPTED action appends one audit line recording ok/path/dispatched/exitCode', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog })
    await d.driveStatus({ projectRoot: root, feature: 'f1' }, 3)
    const lines = readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines[0]).toMatchObject({ action: 'driveStatus', windowId: 3, ok: true, path: 'gatekeeper', dispatched: false, exitCode: 0 })
  })

  it('TEST-257 REQ-013 a simulated audit-log write failure is best-effort — the dispatcher\'s OWN returned OrkyActionResult is unaffected', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const failingAuditLog = { append: vi.fn(() => Promise.reject(new Error('disk full'))) } as unknown as OrkyActionAuditLog
    const { run } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog: failingAuditLog })
    const r = await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ next: 'done' })
  })

  it('TEST-258 REQ-013/CONV-003 the audit log never caps: 10 sequential mixed accepted/rejected calls all produce a line, none dropped', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({ drive: () => ok({ next: 'done' }) })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog })
    for (let i = 0; i < 5; i++) await d.driveStatus({ projectRoot: root, feature: 'f1' })
    for (let i = 0; i < 5; i++) await d.driveStatus({ projectRoot: 'C:/nope' })
    const lines = readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(10)
  })

  it('TEST-259 REQ-013 argsSummary is redaction-safe: human-authored decision/title/detail text is LENGTH-ONLY; structural fields (gate/verdict/escalationId) are verbatim', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog })
    await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass', evidence: 'the human said so, verbatim quote here' })
    const line = JSON.parse(readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').trim())
    const raw = JSON.stringify(line.argsSummary)
    expect(raw).not.toContain('the human said so') // never the raw free-text body
    expect(line.argsSummary.gate).toBe('brainstorm') // structural fields stay verbatim
    expect(line.argsSummary.verdict).toBe('pass')
    expect(typeof line.argsSummary.evidenceLength).toBe('number')
  })
})

describe('OrkyActionDispatcher — malformed/empty/boundary input on EVERY action (REQ-014, CONV-002)', () => {
  it('TEST-260 REQ-014 `undefined` on all four actions returns invalid-args; no CLI spawns; no unhandled rejection', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    const results = await Promise.allSettled([
      d.resolveEscalation(undefined), d.submitWork(undefined), d.recordHumanGate(undefined), d.driveStatus(undefined)
    ])
    for (const res of results) {
      expect(res.status).toBe('fulfilled')
      if (res.status === 'fulfilled') expect(res.value.errorKind).toBe('invalid-args')
    }
    expect(calls).toHaveLength(0)
  })

  it('TEST-261 REQ-014 `{}` on all four actions returns invalid-args; no CLI spawns', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    for (const action of [d.resolveEscalation({}), d.submitWork({}), d.recordHumanGate({}), d.driveStatus({})]) {
      const r = await action
      expect(r.errorKind).toBe('invalid-args')
    }
    expect(calls).toHaveLength(0)
  })

  it('TEST-262 REQ-014 a non-string projectRoot (42) on all four actions returns invalid-args', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r1 = await d.resolveEscalation({ projectRoot: 42, feature: 'f', escalationId: 'E', decision: 'd' })
    const r2 = await d.submitWork({ projectRoot: 42, title: 't' })
    const r3 = await d.recordHumanGate({ projectRoot: 42, feature: 'f', gate: 'brainstorm', verdict: 'pass' })
    const r4 = await d.driveStatus({ projectRoot: 42, feature: 'f' })
    for (const r of [r1, r2, r3, r4]) expect(r.errorKind).toBe('invalid-args')
    expect(calls).toHaveLength(0)
  })

  it('TEST-263 REQ-014 an empty required field per action (escalationId/title/gate) returns invalid-args, distinct per field', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({})
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r1 = await d.resolveEscalation({ projectRoot: root, feature: 'f', escalationId: '', decision: 'd' })
    const r2 = await d.submitWork({ projectRoot: root, title: '' })
    const r3 = await d.recordHumanGate({ projectRoot: root, feature: 'f', gate: '', verdict: 'pass' })
    expect(r1.errorKind).toBe('invalid-args')
    expect(r2.errorKind).toBe('invalid-args')
    expect(r3.errorKind).toBe('invalid-args')
    expect(new Set([r1.error, r2.error, r3.error]).size).toBe(3)
    expect(calls).toHaveLength(0)
  })
})

describe('OrkyActionDispatcher — per-featureDir serialization of mutating actions (REQ-015)', () => {
  it('TEST-264 REQ-015 two concurrent recordHumanGate calls on the SAME featureDir serialize: the second\'s CLI call does not start until the first\'s resolves', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const order: string[] = []
    let releaseFirst!: () => void
    const gate1 = new Promise<void>((resolve) => { releaseFirst = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] !== 'record') throw new Error('unexpected')
      const isFirst = order.length === 0
      order.push(isFirst ? 'first-start' : 'second-start')
      if (isFirst) await gate1
      order.push(isFirst ? 'first-end' : 'second-end')
      return ok({ passed: true })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const p2 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'human-review', verdict: 'pass' })
    await new Promise(r => setTimeout(r, 30))
    expect(order).toEqual(['first-start']) // second has NOT started its CLI call yet
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('TEST-265 REQ-015 concurrent mutating actions on TWO DIFFERENT featureDirs run WITHOUT serializing against each other', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    seedFeature(root, 'f2')
    const order: string[] = []
    let releaseF1!: () => void
    const gateF1 = new Promise<void>((resolve) => { releaseF1 = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      const featureDir = args[2] as string
      const isF1 = featureDir.endsWith('f1')
      order.push(isF1 ? 'f1-start' : 'f2-start')
      if (isF1) await gateF1
      order.push(isF1 ? 'f1-end' : 'f2-end')
      return ok({ passed: true })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const p2 = d.recordHumanGate({ projectRoot: root, feature: 'f2', gate: 'brainstorm', verdict: 'pass' })
    await p2
    expect(order).toEqual(['f1-start', 'f2-start', 'f2-end']) // f2 finished WITHOUT waiting on f1
    releaseF1()
    await p1
  })

  it('TEST-266 REQ-015 driveStatus BYPASSES the queue: it resolves promptly even while a mutating call on the SAME featureDir is still in-flight', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    let releaseRecord!: () => void
    const gateRecord = new Promise<void>((resolve) => { releaseRecord = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] === 'record') { await gateRecord; return ok({ passed: true }) }
      return ok({ next: 'done' }) // drive resolves immediately
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const recordP = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const driveResult = await Promise.race([
      d.driveStatus({ projectRoot: root, feature: 'f1' }),
      new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 2000))
    ])
    expect(driveResult).not.toBe('TIMED_OUT') // driveStatus did NOT wait behind the queued record call
    releaseRecord()
    await recordP
  })

  // ── Loopback (ESC-004, FINDING-DA-001): the queue key must fold case/slash-divergent projectRoot ──
  // spellings of the SAME physical root to the SAME key. Today the queue is keyed on the RAW featureDir
  // string (doResolveEscalation/doRecordHumanGate) or the raw projectRoot (doSubmitWork's no-feature
  // fallback), built from the caller-supplied projectRoot BEFORE normalization — but REQ-004 (TEST-230)
  // deliberately ACCEPTS a case/slash-divergent spelling of an already-allowlisted root. Two concurrent
  // mutating calls submitted with such divergent spellings therefore get DIFFERENT queue keys and do NOT
  // serialize, even though both target the SAME on-disk state.json (Windows is case-insensitive) — a
  // lost-update race in REQ-015's own safety guarantee. One test per call site
  // (doRecordHumanGate/doResolveEscalation/doSubmitWork) so a partial fix (only 1 or 2 of the 3 sites)
  // still leaves at least one of these RED, plus one sanity/no-regression test proving the
  // same-spelling case (TEST-264's own scenario) is untouched by these additions. The approved fix (a
  // LATER, implement-phase change, NOT made here): key `queue.run()` by `normalizeProjectRoot(featureDir)`
  // (or `normalizeProjectRoot(queueKey)` for submitWork's no-feature fallback) at all 3 call sites — the
  // featureDir VALUE passed to the CLI itself is unchanged, only the in-process queue key.

  it('TEST-291 REQ-015/FINDING-DA-001 doRecordHumanGate: two concurrent recordHumanGate calls on the SAME physical feature via a case/slash-DIVERGENT projectRoot spelling still serialize (queue key must be normalizeProjectRoot(featureDir), not the raw string)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const divergent = root.toUpperCase().replace(/\\/g, '/')
    const order: string[] = []
    let releaseFirst!: () => void
    const gate1 = new Promise<void>((resolve) => { releaseFirst = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] !== 'record') throw new Error(`unexpected subcommand: ${args[0]}`)
      const isFirst = order.length === 0
      order.push(isFirst ? 'first-start' : 'second-start')
      if (isFirst) await gate1
      order.push(isFirst ? 'first-end' : 'second-end')
      return ok({ passed: true })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const p2 = d.recordHumanGate({ projectRoot: divergent, feature: 'f1', gate: 'human-review', verdict: 'pass' })
    await new Promise(r => setTimeout(r, 30))
    expect(order).toEqual(['first-start']) // second must NOT have started its CLI call yet
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('TEST-292 REQ-015/FINDING-DA-001 doResolveEscalation (gatekeeper fallback): two concurrent resolveEscalation calls on the SAME physical feature via a case/slash-DIVERGENT projectRoot spelling still serialize', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const divergent = root.toUpperCase().replace(/\\/g, '/')
    const order: string[] = []
    let releaseFirst!: () => void
    const gate1 = new Promise<void>((resolve) => { releaseFirst = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] === 'emit') return ok({ ok: true, mode: 'noop', sent: false, spooled: false }) // feedback disabled -> forces the gatekeeper fallback
      if (args[0] !== 'resolve-escalation') throw new Error(`unexpected subcommand: ${args[0]}`)
      const isFirst = order.length === 0
      order.push(isFirst ? 'first-start' : 'second-start')
      if (isFirst) await gate1
      order.push(isFirst ? 'first-end' : 'second-end')
      return ok({ id: 'ESC-1', resolved: true })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' })
    const p2 = d.resolveEscalation({ projectRoot: divergent, feature: 'f1', escalationId: 'ESC-2', decision: 'reject' })
    await new Promise(r => setTimeout(r, 30))
    expect(order).toEqual(['first-start']) // second's fallback resolve-escalation call must NOT have started yet
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  // SUPERSEDED (intent preserved) by feature 0012-quick-capture-inbox REQ-013, CONV-019: the fixture
  // is keyed on 'submit' (doSubmitWork's invocation after the emit→submit amendment) returning the
  // file-mode receipt. The guard's intent — the normalizeProjectRoot fallback queue key serializes
  // divergent spellings of the same physical root — is untouched.
  it('TEST-293 REQ-015/FINDING-DA-001 doSubmitWork (no-feature project-level fallback key): two concurrent submitWork calls with NO feature field on the SAME physical projectRoot via a case/slash-DIVERGENT spelling still serialize (0012/REQ-013: keyed on submit)', async () => {
    const root = seedProject() // no feature dir needed -- queueKey = projectRoot directly (featureDir is undefined)
    const divergent = root.toUpperCase().replace(/\\/g, '/')
    const order: string[] = []
    let releaseFirst!: () => void
    const gate1 = new Promise<void>((resolve) => { releaseFirst = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] !== 'submit') throw new Error(`unexpected subcommand: ${args[0]}`)
      const isFirst = order.length === 0
      order.push(isFirst ? 'first-start' : 'second-start')
      if (isFirst) await gate1
      order.push(isFirst ? 'first-end' : 'second-end')
      return ok({ ok: true, mode: 'file', id: 'IN-serial', kind: 'work.request', path: 'inbox/IN-serial.json' })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.submitWork({ projectRoot: root, title: 'first work item' })
    const p2 = d.submitWork({ projectRoot: divergent, title: 'second work item' })
    await new Promise(r => setTimeout(r, 30))
    expect(order).toEqual(['first-start']) // second's submit call must NOT have started yet
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('TEST-294 REQ-015 sanity/no-regression: two concurrent recordHumanGate calls on the SAME feature slug via the SAME (non-divergent) projectRoot spelling continue to serialize exactly as TEST-264 (the TEST-291..293 fix-target additions above do not weaken this)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const order: string[] = []
    let releaseFirst!: () => void
    const gate1 = new Promise<void>((resolve) => { releaseFirst = resolve })
    const run = async (_cliPath: string, args: string[]): Promise<CliRun> => {
      if (args[0] !== 'record') throw new Error(`unexpected subcommand: ${args[0]}`)
      const isFirst = order.length === 0
      order.push(isFirst ? 'first-start' : 'second-start')
      if (isFirst) await gate1
      order.push(isFirst ? 'first-end' : 'second-end')
      return ok({ passed: true })
    }
    const d = makeDispatcher({ roots: [root], runCli: run })
    const p1 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    const p2 = d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'human-review', verdict: 'pass' })
    await new Promise(r => setTimeout(r, 30))
    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([p1, p2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })
})

describe('OrkyActionDispatcher — scope guard: exactly five hard-coded subcommands, none request-selectable (REQ-016; submit joined by 0012/REQ-013)', () => {
  // SUPERSEDED (intent preserved) by feature 0012-quick-capture-inbox REQ-013, CONV-019: 'submit'
  // joins the REQUIRED hard-coded literal set (five, none request-selectable) — amended DELIBERATELY,
  // not passed accidentally, because the invariant "only these hard-coded subcommands" would otherwise
  // go silently false. 'emit' STAYS required (doResolveEscalation still rides it); the forbidden set
  // (incl. enable-feedback/disable-feedback) is byte-unchanged.
  it('TEST-267 REQ-016 source-grep: ONLY the five hard-coded subcommand literals (emit/submit/resolve-escalation/record/drive) appear; every forbidden Orky subcommand is absent (0012/REQ-013: submit joined)', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'orky', 'orky-action-dispatcher.ts'), 'utf8')
    for (const forbidden of ['loopback', 'escalate', 'check', 'probe', 'can-advance', 'record-implementer', 'heartbeat', 'enable-feedback', 'disable-feedback']) {
      expect(src).not.toContain(`'${forbidden}'`)
      expect(src).not.toContain(`"${forbidden}"`)
    }
    for (const required of ["'emit'", "'submit'", "'resolve-escalation'", "'record'", "'drive'"]) {
      expect(src).toContain(required)
    }
  })

  it('TEST-268 REQ-016 an extra/unexpected request field (e.g. a "subcommand" field) can NEVER select a different Orky subcommand — recordHumanGate always invokes "record"', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ record: () => ok({ passed: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass', subcommand: 'loopback' } as unknown)
    expect(calls[0].args[0]).toBe('record')
  })

  it('TEST-269 REQ-019 source-grep: the dispatcher NEVER calls writeFile/appendFile/rename/rm/unlink directly — EVERY mutation happens inside the CLI subprocess', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'orky', 'orky-action-dispatcher.ts'), 'utf8')
    expect(src).not.toMatch(/\bwriteFile(Sync)?\(/)
    expect(src).not.toMatch(/\bappendFile(Sync)?\(/)
    expect(src).not.toMatch(/\brename(Sync)?\(/)
    expect(src).not.toMatch(/\brm(Sync)?\(/)
    expect(src).not.toMatch(/\bunlink(Sync)?\(/)
  })

  it('TEST-270 REQ-019 an integration proof: across all four actions on a fixtured .orky/ tree, the ONLY filesystem write anywhere is the audit log under userData — the fixture tree itself never gains/loses a file', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const before = readdirSync(join(root, '.orky', 'features', 'f1')).sort()
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({
      emit: () => ok({ ok: true, mode: 'file' }),
      record: () => ok({ passed: true }),
      drive: () => ok({ next: 'done' })
    })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog })
    await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'E1', decision: 'y' })
    await d.recordHumanGate({ projectRoot: root, feature: 'f1', gate: 'brainstorm', verdict: 'pass' })
    await d.driveStatus({ projectRoot: root, feature: 'f1' })
    expect(readdirSync(join(root, '.orky', 'features', 'f1')).sort()).toEqual(before)
    expect(readdirSync(userData)).toContain('orky-actions.jsonl') // the ONE F7-owned write
  })
})
