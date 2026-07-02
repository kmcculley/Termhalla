// FROZEN integration suite — feature 0012-quick-capture-inbox (phase 4 / TASK-002-adjacent, REQ-013 +
// REQ-010). Drives the REAL `OrkyActionDispatcher` against a FAKE injected `runCli` (the
// tests/main/orky-action-dispatcher.test.ts fakeRunCli convention exactly — the subcommand is
// `args[0]`) and pins doSubmitWork's amended dispatch path: the single hard-coded invocation is now
// the plugin's local-inbox injection `['submit','--app',projectRoot,'--json',JSON.stringify(item)]`
// (plugin v0.28.0+), and the COMPLETE `feedback submit` result universe (02-spec.md "Verified
// contract", FINDING-002) maps as:
//   file-mode receipt (exit 0, {ok:true, mode:'file', id:'IN-…', …})  -> ok:true / dispatched:true (the ONLY success)
//   disabled refusal  (exit 1, {ok:false, mode:'noop', error})        -> the DISTINCT feedback-disabled non-dispatch
//   http refusal      (exit 1, {ok:false, mode:'http', error})        -> cli-error, message VERBATIM (never feedback-disabled)
//   validation refusal(exit 1, {ok:false, mode:'file', error})        -> cli-error, message VERBATIM
//   in-band internal  (exit 0, {ok:false, …, error})                  -> cli-error (ESC-006 chokepoint; exit!=1 so never disabled)
//   internal error    (exit 2, {error})                               -> cli-error, message VERBATIM (pinned in amended TEST-298)
//   old plugin        (exit 2, EMPTY stdout — no `submit` subcommand) -> cli-unparseable "(0 bytes)"
//   timeout           (timedOut:true)                                 -> cli-timeout, exitCode null (CONV-015: INDETERMINATE)
// `mapCliRunToResult` and `orky-action-validate.ts` stay BYTE-UNCHANGED (their frozen suites pin them);
// the disabled discrimination (exitCode===1 && parsed.ok===false && parsed.mode==='noop') lives in the
// dispatcher. resolveEscalation's OWN `emit` path is untouched (TEST-480 pins it green here;
// TEST-234/297/299 stay green byte-unchanged).
//
// This file is NEW — the six sanctioned CONV-019 supersessions of the emit-era pins live in place in
// tests/main/orky-action-dispatcher.test.ts (TEST-237/238/293/267) and
// tests/main/orky-action-dispatcher-codex-001-regression.test.ts (TEST-298/300); see
// .orky/features/0012-quick-capture-inbox/04-tests.md.
//
// Runs RED today: doSubmitWork still invokes 'emit' (TASK-001 not implemented), so every fake keyed
// on 'submit' throws `unexpected subcommand: emit` — except TEST-480, deliberately GREEN (a
// regression pin that resolveEscalation keeps riding emit).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'orky-submit-'))
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
  const d = mkdtempSync(join(tmpdir(), 'orky-submit-userdata-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function fakeAuditLog(): OrkyActionAuditLog { return { append: vi.fn(async () => {}) } as unknown as OrkyActionAuditLog }

/** The fakeRunCli convention of tests/main/orky-action-dispatcher.test.ts, verbatim. */
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
function refusal(exitCode: number, body: unknown): CliRun { return { exitCode, stdout: JSON.stringify(body), timedOut: false } }

/** submit's file-mode receipt — the ONLY success shape (feedback.js:294-298). */
const RECEIPT = { ok: true, mode: 'file', id: 'IN-abc123', kind: 'work.request', path: 'inbox/IN-abc123.json' }
/** The three byte-quoted refusal messages (feedback.js:280-292) — surfaced VERBATIM (CONV-001). */
const DISABLED_MSG = 'feedback is disabled — the write path requires enable-feedback (an audited decision, ADR-027)'
const HTTP_MSG = 'submit writes the LOCAL file inbox; this app uses the http control plane — submit via its inbox API instead'
const VALIDATION_MSG = 'work.request requires a non-empty title'

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

// ---------------------------------------------------------------------------------------------------

describe('doSubmitWork — the amended `submit` invocation (REQ-013)', () => {
  it('TEST-469 REQ-013 enabled: the invocation argv is EXACTLY [submit, --app, root, --json, <json>] and the file-mode receipt maps to ok:true/dispatched:true/feedback:enabled with the receipt as data', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ submit: () => ok(RECEIPT) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toHaveLength(5)
    expect(calls[0].args.slice(0, 4)).toEqual(['submit', '--app', root, '--json'])
    const item = JSON.parse(calls[0].args[4])
    expect(item).toEqual({ kind: 'work.request', title: 'fix the thing' }) // no detail/phase/feature keys when absent
    expect(r).toMatchObject({ ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, exitCode: 0 })
    expect(r.data).toEqual(RECEIPT)
  })

  it('TEST-470 REQ-013 the validated optionals (detail/phase/feature) travel INSIDE the one JSON item element — never as their own argv elements (no --feature, no --payload, no --type)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ submit: () => ok(RECEIPT) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, feature: 'f1', title: 't', detail: 'longer body', phase: 'spec' })
    expect(r.ok).toBe(true)
    expect(calls[0].args).toHaveLength(5) // STILL five elements — nothing rides raw argv
    for (const banned of ['--feature', '--payload', '--type']) expect(calls[0].args).not.toContain(banned)
    const item = JSON.parse(calls[0].args[4])
    expect(item).toEqual({ kind: 'work.request', title: 't', detail: 'longer body', phase: 'spec', feature: 'f1' })
  })

  it('TEST-471 REQ-013 REQ-010 boundary payloads round-trip BYTE-VERBATIM inside the JSON element: a --json-prefixed title, a --payload-prefixed title, a 1-char title, emoji/CJK, CRLF newlines, and a 10 000-line detail (no truncation anywhere)', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ submit: () => ok(RECEIPT) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const hugeDetail = Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join('\n')
    const vectors: Array<{ title: string; detail?: string }> = [
      { title: '--json injected' },                       // TEST-290's safety property carried to --json
      { title: '--payload injected' },
      { title: 'x' },                                     // 1-char title
      { title: '🚀 修复 Ω émoji', detail: 'детали 詳細 🧪' }, // non-ASCII/emoji/CJK
      { title: 'crlf', detail: 'a\r\nb\r\nc' },           // CRLF preserved, not normalized
      { title: 'huge', detail: hugeDetail }               // no length bound client- or dispatcher-side (CONV-003)
    ]
    for (const v of vectors) {
      const r = await d.submitWork({ projectRoot: root, title: v.title, ...(v.detail !== undefined ? { detail: v.detail } : {}) })
      expect(r.ok).toBe(true)
      const item = JSON.parse(calls[calls.length - 1].args[4])
      expect(item.title).toBe(v.title)                    // byte-verbatim
      if (v.detail !== undefined) expect(item.detail).toBe(v.detail)
      else expect('detail' in item).toBe(false)
    }
    const huge = JSON.parse(calls[calls.length - 1].args[4])
    expect(huge.detail.length).toBe(hugeDetail.length)    // nothing sliced/capped
  })

  it('TEST-472 REQ-013 an extra request field can NEVER select a different subcommand — submitWork always invokes the hard-coded "submit" literal', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ submit: () => ok(RECEIPT) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    await d.submitWork({ projectRoot: root, title: 't', subcommand: 'enable-feedback' } as unknown)
    expect(calls[0].args[0]).toBe('submit')
    expect(calls[0].args).not.toContain('enable-feedback')
  })
})

describe('doSubmitWork — the COMPLETE submit refusal universe (REQ-013, FINDING-002)', () => {
  it('TEST-473 REQ-013 disabled refusal (exit 1 + {ok:false, mode:"noop", error}) is the DISTINCT feedback-disabled non-dispatch whose error CONTAINS the CLI refusal VERBATIM; no gatekeeper call ever happens', async () => {
    const root = seedProject()
    const { run, calls } = fakeRunCli({ submit: () => refusal(1, { ok: false, mode: 'noop', error: DISABLED_MSG }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r).toMatchObject({ ok: false, path: 'feedback', feedback: 'disabled', dispatched: false, errorKind: 'feedback-disabled', exitCode: 1 })
    expect(r.error).toContain(DISABLED_MSG) // verbatim (context MAY be prepended, never replaced)
    expect(calls.map(c => c.args[0])).toEqual(['submit'])
  })

  it('TEST-474 REQ-013 http-mode refusal (exit 1 + {ok:false, mode:"http", error}) stays generic cli-error carrying the control-plane redirect VERBATIM — NEVER presented as feedback-disabled, and nothing is spooled/dispatched', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => refusal(1, { ok: false, mode: 'http', error: HTTP_MSG }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.errorKind).not.toBe('feedback-disabled')
    expect(r.dispatched).toBe(false)
    expect(r.error).toContain(HTTP_MSG)
    expect(r.error).toContain('control plane') // the redirect is actionable, not swallowed
  })

  it('TEST-475 REQ-013 validation refusal (exit 1 + {ok:false, mode:"file", error}) stays cli-error with the CLI message VERBATIM (a hand-called bypass surfaces honestly)', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => refusal(1, { ok: false, mode: 'file', error: VALIDATION_MSG }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: '   ' }) // whitespace passes F7's non-empty check; the CLI refuses
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.errorKind).not.toBe('feedback-disabled')
    expect(r.error).toContain(VALIDATION_MSG)
  })

  it('TEST-476 REQ-013 an IN-BAND internal error (exit 0 + {ok:false, mode:"noop", error}) maps through the ESC-006 chokepoint to cli-error — the disabled discrimination requires exit 1, so exit-0 mode:noop can NEVER be misdiagnosed as feedback-disabled', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => ok({ ok: false, mode: 'noop', error: 'disk full' }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-error')
    expect(r.errorKind).not.toBe('feedback-disabled')
    expect(r.error).toContain('disk full')
  })

  it('TEST-477 REQ-013 an OLDER plugin (< v0.28.0, no `submit` subcommand: usage to stderr, EMPTY stdout, exit 2) maps to the honest cli-unparseable "(0 bytes)" — never a silent success, never feedback-disabled', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => ({ exitCode: 2, stdout: '', timedOut: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-unparseable')
    expect(r.error).toContain('(0 bytes)')
    expect(r.dispatched).toBe(false)
  })

  it('TEST-478 REQ-013 a timed-out submit child resolves (never hangs) as cli-timeout with exitCode null — the INDETERMINATE outcome (CONV-015: the unref()\'d child may still complete the write)', async () => {
    const root = seedProject()
    const { run } = fakeRunCli({ submit: () => ({ exitCode: null, stdout: '', timedOut: true }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.submitWork({ projectRoot: root, title: 'fix the thing' })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('cli-timeout')
    expect(r.exitCode).toBeNull()
  })
})

describe('doSubmitWork — audit + path scope unchanged by the amendment (REQ-013)', () => {
  it('TEST-479 REQ-013 the audit record for a submit invocation still carries titleLength/detailLength ONLY — the raw title/detail text NEVER reaches the audit log', async () => {
    const root = seedProject()
    const userData = tmpUserDataDir()
    const auditLog = new OrkyActionAuditLog(userData)
    const { run } = fakeRunCli({ submit: () => ok(RECEIPT) })
    const d = makeDispatcher({ roots: [root], runCli: run, auditLog })
    await d.submitWork({ projectRoot: root, title: 'a secret capture title', detail: 'a secret capture body' }, 7)
    const line = JSON.parse(readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').trim())
    expect(line).toMatchObject({ action: 'submitWork', windowId: 7, ok: true, dispatched: true })
    const raw = JSON.stringify(line)
    expect(raw).not.toContain('a secret capture title')
    expect(raw).not.toContain('a secret capture body')
    expect(line.argsSummary.titleLength).toBe('a secret capture title'.length)
    expect(line.argsSummary.detailLength).toBe('a secret capture body'.length)
  })

  it('TEST-480 REQ-013 resolveEscalation STILL rides `feedback emit` — its path is untouched by the submitWork amendment (deliberately GREEN today; regression pin alongside frozen TEST-234/297/299)', async () => {
    const root = seedProject()
    seedFeature(root, 'f1')
    const { run, calls } = fakeRunCli({ emit: () => ok({ ok: true, mode: 'file', event: 'evt-1', sent: true, spooled: false }) })
    const d = makeDispatcher({ roots: [root], runCli: run })
    const r = await d.resolveEscalation({ projectRoot: root, feature: 'f1', escalationId: 'ESC-1', decision: 'approve' })
    expect(r).toMatchObject({ ok: true, path: 'feedback', feedback: 'enabled', dispatched: true })
    expect(calls.map(c => c.args[0])).toEqual(['emit'])
    expect(calls[0].args).toContain('--payload') // the emit argv shape survives for resolveEscalation
  })
})
