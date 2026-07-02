// FROZEN e2e suite — feature 0008-queue-answer-resume-actions, tests phase, LOOPBACK 1
// (review → tests, per ESC-001). Playwright-for-Electron against out/ (`npm run build` first);
// NOT in the `npm test` gate. Harness mirrors the frozen tests/e2e/orky-queue-actions.spec.ts
// (stub Orky CLIs in ORKY_PLUGIN_DIR, fixtured .orky project, the REAL registry:detail binding
// source), extended with a garbage-stdout gatekeeper mode (an honest cli-unparseable vector) and
// the quick.json toasts-enabled seed (the 0012 orky-capture.spec.ts pattern).
//
//   TEST-620 — FINDING-016/FINDING-017 (REQ-012/REQ-006/REQ-004): opening the answer flow moves
//              keyboard focus INTO dq-action-answer-input; Enter on a whitespace-only decision
//              dispatches NOTHING (the refusal gates hold on the Enter path too); Enter on the
//              typed decision dispatches exactly ONE byte-verbatim emit and renders the honest
//              success — no pointer and no Tab traversal required to complete the primary flow.
//   TEST-621 — FINDING-020 (REQ-004/REQ-008): the answer form DISARMS on success — the form
//              closes and the decision text is cleared, so a settled answer cannot be re-fired
//              against the still-open escalation (on the feedback path the escalation stays open
//              until Orky applies the queued decision — exactly the duplicate-invite window).
//              Re-opening re-binds fresh with an EMPTY input and re-fires nothing by itself.
//   TEST-622 — FINDING-011 (REQ-003/REQ-008): the rendered result/error is scoped to the control
//              the user is looking at — opening the answer form clears a stale settled outcome
//              from ANOTHER action: (a) a stale preview SUCCESS result disappears on open; (b) a
//              stale preview FAILURE (cli-unparseable via garbage stdout) no longer masks the
//              answer flow's own state — the error clears and the bound target renders.
//   TEST-623 — FINDING-012 (REQ-010, the contract blocker): a detached SUCCESS is NEVER silently
//              swallowed — submit an answer against a slow CLI, close the drawer mid-flight, and
//              the settled success still reports through the store-level pushToast chokepoint as
//              a default-kind (suppressible — hence toasts enabled here) toast carrying the SAME
//              honest copy class, mirroring F12's OrkyCaptureModal detached-success behavior.
//
// Runs RED today against the reviewed implementation (verified in source before pinning):
// toggleAnswer moves no focus (620), dq-action-answer-input has no Enter path (620), the form
// stays armed after success (621), `phase` is never reset when the form opens (622), and
// deliver() drops a detached success outright — "only failures must never be swallowed" (623).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

// ── stub Orky CLIs (the frozen orky-queue-actions.spec.ts pattern) ──────────────────────────────
const FEEDBACK_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { behavior: 'enabled', delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const out = mode.behavior === 'disabled'
  ? { ok: true, mode: 'noop' }
  : { ok: true, mode: 'file', id: 'FB-e2e-0008L', path: 'outbox/FB-e2e-0008L.json' }
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`
/** gatekeeper stub: 'drive' answers the REAL gk drive() shape (structured next/phase/reason —
 *  gatekeeper.js:843-904, per FINDING-013); behavior 'garbage' prints non-JSON stdout at exit 0 —
 *  the genuine cli-unparseable class (orky-action-result.ts:42-56). */
const GATEKEEPER_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { behavior: 'enabled', delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const sub = args[0]
const out = sub === 'drive' ? { next: 'await-human', reason: 'open escalation', escalations: ['ESC-007'] }
  : sub === 'resolve-escalation' ? { id: 'ESC-007', status: 'resolved' }
  : {}
const payload = mode.behavior === 'garbage' ? 'gatekeeper melted mid-report: not the JSON you expected' : JSON.stringify(out)
setTimeout(() => { process.stdout.write(payload, () => process.exit(0)) }, mode.delayMs || 0)
`

interface Plugin { pluginDir: string; feedbackLog: string; gatekeeperLog: string; feedbackMode: string; gatekeeperMode: string }
function seedPlugin(behavior: 'enabled' | 'disabled', delayMs = 0): Plugin {
  const pluginDir = mkdtempSync(join(tmpdir(), 'termh-dqal-plugin-'))
  for (const kind of ['feedback', 'gatekeeper'] as const) {
    mkdirSync(join(pluginDir, kind), { recursive: true })
    writeFileSync(join(pluginDir, kind, 'cli.js'), kind === 'feedback' ? FEEDBACK_STUB : GATEKEEPER_STUB, 'utf8')
    writeFileSync(join(pluginDir, kind, 'mode.json'), JSON.stringify({ behavior, delayMs }), 'utf8')
  }
  return {
    pluginDir,
    feedbackLog: join(pluginDir, 'feedback', 'argv-log.jsonl'),
    gatekeeperLog: join(pluginDir, 'gatekeeper', 'argv-log.jsonl'),
    feedbackMode: join(pluginDir, 'feedback', 'mode.json'),
    gatekeeperMode: join(pluginDir, 'gatekeeper', 'mode.json')
  }
}
function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** The frozen suite's fixture: a RESOLVED escalation FIRST, the open ESC-007 second. */
function seedEscalatedProject(prefix = 'termh-dqal-proj-'): { proj: string; statePath: string } {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const fdir = join(proj, '.orky', 'features', 'demo-feature')
  mkdirSync(fdir, { recursive: true })
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  writeFileSync(join(proj, '.orky', 'active.json'), JSON.stringify({
    feature: '.orky/features/demo-feature', projectRoot: proj, phase: 'implement',
    lastTickAt: new Date().toISOString(), lastAction: 'escalate'
  }), 'utf8')
  const statePath = join(fdir, 'state.json')
  writeFileSync(statePath, JSON.stringify({
    feature: 'demo-feature', phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [
      { id: 'ESC-001', status: 'resolved', reason: 'an earlier, already-answered question' },
      { id: 'ESC-007', status: 'open', reason: 'pick option A or B' }
    ]
  }), 'utf8')
  writeFileSync(join(fdir, 'findings.json'), JSON.stringify([]), 'utf8')
  return { proj, statePath }
}

function seedUserData(roots: string[], opts?: { toasts?: boolean }): string {
  const userData = mkdtempSync(join(tmpdir(), 'termh-dqal-ud-'))
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
  if (opts?.toasts) writeFileSync(join(userData, 'quick.json'), JSON.stringify({ toastsEnabled: true }), 'utf8')
  return userData
}

function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, ...env } as Record<string, string>
  })
}

type Win = Awaited<ReturnType<ElectronApplication['firstWindow']>>
const focusedTestId = (win: Win): Promise<string | null> =>
  win.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null)

async function openQueue(win: Win): Promise<void> {
  await expect(win.getByTestId('orky-queue-toggle')).toBeVisible({ timeout: 20_000 })
  await win.getByTestId('orky-queue-toggle').click()
  await expect(win.locator('[data-testid="decision-queue-item"]')).toHaveCount(1, { timeout: 20_000 })
}

test('TEST-620 REQ-012 REQ-006 REQ-004 (FINDING-016/017) open-focus + Enter-submit: opening the answer flow focuses the decision input; Enter on whitespace dispatches NOTHING; Enter on the typed decision dispatches exactly ONE byte-verbatim emit and renders the honest success', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  // FINDING-016: the open gesture moves keyboard focus INTO the decision input — no second aim,
  // no Tab traversal across "next?"/"resume in terminal".
  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await expect.poll(() => focusedTestId(win), { timeout: 5_000 }).toBe('dq-action-answer-input')

  // FINDING-017 + REQ-004: the Enter path respects the same refusal gates as the submit control —
  // a whitespace-only decision dispatches nothing.
  const input = win.getByTestId('dq-action-answer-input')
  await input.fill('   ')
  await input.press('Enter')
  await win.waitForTimeout(800)
  expect(readLog(feedbackLog)).toEqual([])
  expect(readLog(gatekeeperLog)).toEqual([])
  await expect(win.getByTestId('dq-action-pending')).toHaveCount(0)

  // FINDING-017: typing the decision and pressing Enter IN THE INPUT completes the flow.
  const decision = 'Take option B — Enter-submitted, byte-verbatim ✔'
  await input.fill(decision)
  await input.press('Enter')
  const result = win.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/answered|submitted/i)
  await expect(result).not.toContainText(/done|complete/i)

  // the wire truth: exactly ONE emit, the bound id + the decision byte-verbatim.
  const fLog = readLog(feedbackLog)
  expect(fLog).toHaveLength(1)
  expect(fLog[0][0]).toBe('emit')
  expect(fLog[0][7]).toBe('--payload')
  expect(JSON.parse(fLog[0][8])).toEqual({ escalationId: 'ESC-007', decision })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-621 REQ-004 REQ-008 (FINDING-020) the answer form DISARMS on success: the form closes and the decision clears, so the settled answer cannot be re-fired against the still-open escalation; re-opening re-binds with an EMPTY input and re-fires nothing', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await win.getByTestId('dq-action-answer-input').fill('ship option B')
  await win.getByTestId('dq-action-answer-submit').click()
  const result = win.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/answered|submitted/i)

  // FINDING-020: on the feedback path the escalation STAYS open until Orky applies the queued
  // decision (the fixture's state.json is untouched by the stub), so the row remains queued and a
  // still-armed form holding the same payload is a duplicate-write invite. The form must disarm:
  // closed (or equivalently un-refirable) with the decision text cleared.
  await expect(win.getByTestId('dq-action-answer-input')).toHaveCount(0)

  // Re-arming is an explicit gesture: re-open → fresh binding, EMPTY input, and nothing re-fires
  // without new text + a new submit.
  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await expect(win.getByTestId('dq-action-answer-input')).toHaveValue('')
  await win.waitForTimeout(800)
  expect(readLog(feedbackLog)).toHaveLength(1)   // still exactly the one dispatch

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-622 REQ-003 REQ-008 (FINDING-011) the rendered outcome is scoped to the active control: opening the answer form clears a stale preview RESULT, and a stale preview FAILURE (cli-unparseable) no longer masks the answer flow\'s own state', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, gatekeeperMode } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  // (a) a stale preview SUCCESS: the settled result renders, then opening the answer form clears
  // it — the success text of one control never sits beside the logically unrelated fresh form.
  await win.getByTestId('dq-action-preview').click()
  const result = win.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/next/i)
  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-result')).toHaveCount(0)          // stale result cleared on open
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await win.getByTestId('dq-action-answer').click()                          // close the form again

  // (b) a stale preview FAILURE: garbage stdout at exit 0 is the genuine cli-unparseable class —
  // it renders, then opening the answer form clears it instead of masking the answer's own state
  // (the FINDING-011 vector: the unrelated failure must not outrank the fresh context).
  writeFileSync(gatekeeperMode, JSON.stringify({ behavior: 'garbage', delayMs: 0 }), 'utf8')
  await win.getByTestId('dq-action-preview').click()
  const err = win.getByTestId('dq-action-error')
  await expect(err).toBeVisible({ timeout: 20_000 })
  await expect(err).toHaveAttribute('data-error-kind', 'cli-unparseable')
  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-error')).toHaveCount(0)            // the stale failure no longer masks
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-623 REQ-010 (FINDING-012, the contract blocker) a detached SUCCESS is never silently swallowed: close the drawer while the answer is in flight — the settled success still reports through pushToast (default suppressible kind, toasts enabled) with the SAME honest copy class', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj], { toasts: true })  // the success channel is the SUPPRESSIBLE default kind — enabled here
  const { pluginDir, feedbackLog } = seedPlugin('enabled', 2500) // slow enough to close the drawer mid-flight
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await win.getByTestId('dq-action-answer-input').fill('answer that lands while the drawer is closed')
  await win.getByTestId('dq-action-answer-submit').click()
  await expect(win.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })

  // detach: close the drawer (the row unmounts) while the CLI is still running.
  await win.getByTestId('orky-queue-toggle').click()
  await expect(win.locator('[data-testid="decision-queue-item"]')).toHaveCount(0)

  // REQ-010: "the settled outcome MUST still be reported through the store-level toast chokepoint
  // (pushToast) … No outcome is ever silently swallowed." The durable write landed — the user MUST
  // get the confirmation, with the same honest wording class the in-flight path would have shown
  // (mirrors F12: OrkyCaptureModal pushes the detached success unconditionally).
  const toast = win.getByTestId('toast')
  await expect(toast).toContainText(/answered|submitted/i, { timeout: 20_000 })
  await expect(toast).not.toContainText(/done|complete/i)
  await expect.poll(() => readLog(feedbackLog).length, { timeout: 20_000 }).toBe(1)  // ONE dispatch, honestly reported

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
