// FINDING-CODEX-001 regression suite — feature 0007-orky-action-dispatch (loopback-3, ESC-006).
// Targets `src/main/orky/orky-action-dispatcher.ts`'s `doResolveEscalation`/`doSubmitWork`, which both
// call the shared `mapCliRunToResult` (src/shared/orky-action-result.ts) then branch on
// `data.mode !== 'noop'` to decide feedback-enabled vs feedback-disabled. Today (RED) `mapCliRunToResult`
// maps ANY feedback exit-0 to `{ok:true, data:parsed}` regardless of the parsed stdout's own `ok` field
// (see the companion `tests/shared/orky-action-result-codex-001-regression.test.ts`), so a genuine
// feedback-CLI INTERNAL error — `{ok:false, mode:'noop', error, note:'emit is non-fatal'}` — is
// misdiagnosed here as "feedback disabled": resolveEscalation silently falls back to the gatekeeper CLI
// (masking the real error if the fallback happens to succeed) and submitWork reports
// `errorKind:'feedback-disabled'` with a misleading "enable it" message instead of the CLI's own error.
// ESC-006 (approved fix contract): once `mapCliRunToResult` inspects `parsed.ok`, both actions must
// surface `{ok:false, errorKind:'cli-error', error:<CLI's own message>}` for this stimulus instead.
//
// The genuine disabled-channel no-op — `{ok:true, mode:'noop'}` — is NOT the defect and MUST be left
// unharmed by the fix: resolveEscalation still falls back to gatekeeper and succeeds; submitWork still
// reports the distinct `feedback-disabled` non-dispatch outcome. Pinned here too so a fix that is too
// broad (e.g. rejecting on `mode==='noop'` regardless of `ok`) is caught as a regression.
//
// NEW file — does not modify `tests/main/orky-action-dispatcher.test.ts` (FROZEN; TEST-229..294 untouched).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'orky-actdisp-codex001-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function seedFeature(root: string, slug: string): string {
  const fdir = join(root, '.orky', 'features', slug)
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({ feature: slug, phase: 'implement', gates: {}, escalations: [] }), 'utf8')
  return fdir
}

function fakeAuditLog(): OrkyActionAuditLog { return { append: vi.fn(async () => {}) } as unknown as OrkyActionAuditLog }

/** Builds a fake `runCli` that records every call and dispatches to a per-subcommand handler (the
 *  subcommand is `args[0]`, e.g. 'emit'/'resolve-escalation') — matches
 *  tests/main/orky-action-dispatcher.test.ts's own `fakeRunCli` convention exactly. */
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

function makeDispatcher(opts: {
  roots: string[]
  runCli: (cliPath: string, args: string[], o?: unknown) => Promise<CliRun>
  auditLog?: OrkyActionAuditLog
}): OrkyActionDispatcher {
  return new OrkyActionDispatcher({
    registry: { roots: () => opts.roots },
    auditLog: opts.auditLog ?? fakeAuditLog(),
    queue: new OrkyActionQueue(),
    runCli: opts.runCli,
    locateOrkyCli: () => '/fake/cli.js'
  })
}

describe('OrkyActionDispatcher — FINDING-CODEX-001: a genuine feedback-CLI internal error must NOT be misdiagnosed as "feedback disabled" (REQ-002/REQ-006/REQ-007/REQ-011)', () => {
  it('TEST-297 REQ-002/006/011 resolveEscalation: feedback emit exit 0 + {ok:false, mode:"noop", error:"disk full"} yields ok:false/errorKind:"cli-error" carrying "disk full" — the gatekeeper fallback must NEVER run for a genuine internal error', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({
      emit: () => ok({ ok: false, mode: 'noop', error: 'disk full', note: 'emit is non-fatal' }),
      'resolve-escalation': () => ok({ id: 'ESC-1', resolved: true, decision: 'approve' })
    })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toContain('disk full')
    expect(calls.map(c => c.args[0])).toEqual(['emit']) // NOT ['emit', 'resolve-escalation'] — no silent fallback
  })

  it('TEST-298 REQ-002/007/011 submitWork: feedback emit exit 0 + {ok:false, mode:"noop", error:"disk full"} yields ok:false/errorKind:"cli-error" carrying "disk full" — NEVER errorKind:"feedback-disabled" with the misleading "enable it" message', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ emit: () => ok({ ok: false, mode: 'noop', error: 'disk full', note: 'emit is non-fatal' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toContain('disk full')
    expect(r.errorKind).not.toBe('feedback-disabled')
  })

  it('TEST-299 REQ-006 disabled-path regression guard: resolveEscalation with a GENUINE no-op ({ok:true, mode:"noop"}) still falls back to gatekeeper and succeeds exactly as before the fix', async () => {
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
  })

  it('TEST-300 REQ-007 disabled-path regression guard: submitWork with a GENUINE no-op ({ok:true, mode:"noop"}) still reports the DISTINCT feedback-disabled non-dispatch outcome exactly as before the fix', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ emit: () => ok({ ok: true, mode: 'noop', sent: false, spooled: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r).toMatchObject({ ok: false, path: 'feedback', feedback: 'disabled', dispatched: false, errorKind: 'feedback-disabled' })
    expect(calls.map(c => c.args[0])).toEqual(['emit'])
  })
})
