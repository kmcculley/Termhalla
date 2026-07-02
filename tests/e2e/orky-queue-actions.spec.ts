// FROZEN e2e suite — feature 0008-queue-answer-resume-actions (phase 4; DoD acceptance).
// Playwright-for-Electron against out/ (`npm run build` first). Covers what the node harness cannot
// reach (0009 "Testability constraint"; real keyboard/pointer vectors per the F6 TEST-372 lesson).
//
// The dispatch chain is REAL end-to-end: gesture → useOrkyEntryActions → api.orkyResolveEscalation /
// api.orkyDriveStatus → preload → registrar → OrkyActionDispatcher → runOrkyCli(process.execPath,
// [cli.js, …]) → STUB Orky CLIs seeded into ORKY_PLUGIN_DIR (feedback/cli.js + gatekeeper/cli.js —
// the 0012 orky-capture.spec.ts pattern, extended with a gatekeeper stub because resolveEscalation's
// disabled-feedback fallback and driveStatus both ride the gatekeeper CLI). Each stub appends its
// received argv to its own argv-log.jsonl — the byte-verbatim proof surface — and answers per a
// sibling mode.json. The escalation-id ground truth is the fixtured .orky/features/*/state.json the
// REAL registry:detail channel reads (REQ-003's binding source).
//
//   TEST-608 — REQ-001/002/003/004/005/006/007/008/012: the answer-an-escalation flow end-to-end —
//              zero dispatch on open/mount, the bound id (ESC-007, the FIRST OPEN escalation — not
//              the resolved ESC-001) rendered beside the input BEFORE dispatch, whitespace-only
//              decisions can't submit, native-button Enter activation, a double-Enter race yields
//              exactly ONE `feedback emit` with the pinned argv + byte-verbatim payload, pending →
//              honest success (answered/submitted, never done/complete), and the read-only preview
//              (`gatekeeper drive`) renders the next action with NO mutation-claiming word.
//   TEST-609 — REQ-014/REQ-005: resume-in-terminal — one gesture commits exactly ONE terminal pane
//              running `claude /orky:resume` AT the entry's projectRoot (proven by a PATH-stubbed
//              claude.cmd logging its CWD + argv), with ZERO api.orky* dispatches; a second gesture
//              commits a second pane (no dedupe); the control copy says terminal/claude/session and
//              never claims an auto-run.
//   TEST-610 — REQ-015: pointer isolation on a hasPane row — clicking the answer control and
//              clicking+typing into the inline input steal no focus to the matched pane (the row's
//              focus-project gesture never fires), while a ROW-BODY click still focuses the pane
//              (the amended frozen TEST-366's complementary half).
//   TEST-611 — REQ-002/004/008: the disabled-feedback path — `feedback emit` answers mode:'noop',
//              the dispatcher falls back to `gatekeeper resolve-escalation`, and the fallback argv
//              carries the BOUND id + the decision byte-verbatim as discrete argv elements; the
//              rendered success stays honest.
//   TEST-612 — REQ-003 (FINDING-003 race): the bound escalation is resolved (a DIFFERENT one opens)
//              between display and submit — the submit-time re-verification refuses, NOTHING is
//              dispatched (both stub logs stay empty), and the honest "changed — re-open to answer"
//              message renders; the newly-open ESC-009 is never silently substituted.
//
// Runs RED today by construction: the shipped tree renders no dq-action-* element (feature 0008's
// orky-entry-actions module does not exist and DecisionQueuePanel mounts no actions region).
//
// [AMENDED at the ESC-001 tests LOOPBACK (review → tests), 2026-07-02 — FINDING-013 supersession]:
// the gatekeeper stub's `drive` answer was the flattened {next:'await-human'} — an
// under-specified fixture that let the shipped preview drop the phase/reason the REAL gk drive()
// carries (gatekeeper.js:850: {next:'await-human', reason:'open escalation', escalations:[…]}).
// The stub now answers the REAL shape and TEST-608's preview assertions additionally require the
// carried reason to render. Every other assertion and TEST id is byte-unchanged.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

// ── stub Orky CLIs (the 0012 pattern; same execFile(process.execPath, [cli.js, …]) mechanism) ────
/** feedback stub: logs argv from 'emit' on; behavior 'enabled' → emit accepted (mode:'file');
 *  'disabled' → the genuine disabled-channel no-op (exit 0, {ok:true, mode:'noop'} — the ONE shape
 *  the dispatcher's fallback branch keys on, orky-action-dispatcher.ts:168). */
const FEEDBACK_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { behavior: 'enabled', delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const out = mode.behavior === 'disabled'
  ? { ok: true, mode: 'noop' }
  : { ok: true, mode: 'file', id: 'FB-e2e-0008', path: 'outbox/FB-e2e-0008.json' }
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`
/** gatekeeper stub: logs argv; answers 'drive' with a computed next action, 'resolve-escalation'
 *  with a resolved receipt, 'record' with an empty object — all exit 0. */
const GATEKEEPER_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const sub = args[0]
const out = sub === 'drive' ? { next: 'await-human', reason: 'open escalation', escalations: ['ESC-007'] } // [AMENDED — FINDING-013] the REAL drive shape (gatekeeper.js:850), never a flattened string
  : sub === 'resolve-escalation' ? { id: 'ESC-007', status: 'resolved' }
  : {}
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`

interface Plugin { pluginDir: string; feedbackLog: string; gatekeeperLog: string; feedbackMode: string }
function seedPlugin(behavior: 'enabled' | 'disabled', delayMs = 0): Plugin {
  const pluginDir = mkdtempSync(join(tmpdir(), 'termh-dqa-plugin-'))
  for (const kind of ['feedback', 'gatekeeper'] as const) {
    mkdirSync(join(pluginDir, kind), { recursive: true })
    writeFileSync(join(pluginDir, kind, 'cli.js'), kind === 'feedback' ? FEEDBACK_STUB : GATEKEEPER_STUB, 'utf8')
    writeFileSync(join(pluginDir, kind, 'mode.json'), JSON.stringify({ behavior, delayMs }), 'utf8')
  }
  return {
    pluginDir,
    feedbackLog: join(pluginDir, 'feedback', 'argv-log.jsonl'),
    gatekeeperLog: join(pluginDir, 'gatekeeper', 'argv-log.jsonl'),
    feedbackMode: join(pluginDir, 'feedback', 'mode.json')
  }
}
function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** A synthetic `.orky/` project whose feature carries a RESOLVED escalation FIRST and the open
 *  ESC-007 second — the binding must pick the first OPEN one, never the first array entry
 *  (REQ-003; the free-text detail deliberately cannot be the source: it names no id). */
function seedEscalatedProject(prefix = 'termh-dqa-proj-'): { proj: string; statePath: string } {
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

function seedUserData(roots: string[]): string {
  const userData = mkdtempSync(join(tmpdir(), 'termh-dqa-ud-'))
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
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

async function openTerminalAt(win: Win, dir: string): Promise<void> {
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${dir}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${dir.replace(/\\/g, '\\\\')}"]`)).toHaveCount(1, { timeout: 15_000 })
}

test('TEST-608 REQ-001/002/003/004/005/006/007/008/012 answer-an-escalation end-to-end: zero dispatch on open, the bound ESC-007 shown BEFORE dispatch, whitespace can\'t submit, double-Enter is single-flight, ONE pinned emit argv with the byte-verbatim payload, honest success; the preview renders the next action with no mutation claim [AMENDED — FINDING-013: the REAL drive shape; the carried reason renders]', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled', 1000) // slow enough for pending + the double-gesture race
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  // REQ-001/REQ-002: the actions region exists per row; reason 'escalation' offers the answer +
  // preview + resume controls and NO human-review verdict chrome.
  await expect(win.getByTestId('dq-action-answer')).toBeVisible()
  await expect(win.getByTestId('dq-action-preview')).toBeVisible()
  await expect(win.getByTestId('dq-action-resume')).toBeVisible()
  await expect(win.getByTestId('dq-action-verdict-pass')).toHaveCount(0)
  // REQ-006: opening the drawer / mounting the region dispatched NOTHING.
  expect(readLog(feedbackLog)).toEqual([])
  expect(readLog(gatekeeperLog)).toEqual([])

  // REQ-003: opening the answer binds the FIRST OPEN escalation (ESC-007 — not the resolved
  // ESC-001) off the REAL registry:detail channel and shows it BEFORE any dispatch.
  await win.getByTestId('dq-action-answer').click()
  const target = win.getByTestId('dq-action-answer-target')
  await expect(target).toBeVisible({ timeout: 10_000 })
  await expect(target).toContainText('ESC-007')
  await expect(target).not.toContainText('ESC-001')
  expect(readLog(feedbackLog)).toEqual([])                 // binding is a read, never a CLI call

  // REQ-004: whitespace-only decisions cannot dispatch (submit disabled).
  const input = win.getByTestId('dq-action-answer-input')
  const submit = win.getByTestId('dq-action-answer-submit')
  await expect(submit).toBeDisabled()
  await input.fill('   ')
  await expect(submit).toBeDisabled()
  const decision = 'Take option B — ship the --json variant ✔'
  await input.fill(decision)
  await expect(submit).toBeEnabled()

  // REQ-012 (native activation) + REQ-007 (single-flight): Enter on the FOCUSED submit button
  // activates THAT button; a second Enter before the slow result settles is a no-op.
  await submit.focus()
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter')
  // REQ-008: pending renders while in flight, with the control disabled.
  await expect(win.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })
  await expect(submit).toBeDisabled()

  // settle → honest success: answered/submitted, never done/complete (REQ-008).
  const result = win.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/answered|submitted/i)
  await expect(result).not.toContainText(/done|complete/i)
  await expect(win.getByTestId('dq-action-error')).toHaveCount(0)

  // the wire truth (REQ-001/003/004/007): exactly ONE emit, the pinned argv, byte-verbatim payload.
  const fLog = readLog(feedbackLog)
  expect(fLog).toHaveLength(1)
  expect(fLog[0].slice(0, 7)).toEqual(['emit', '--app', proj, '--type', 'decision', '--feature', 'demo-feature'])
  expect(fLog[0][7]).toBe('--payload')
  expect(JSON.parse(fLog[0][8])).toEqual({ escalationId: 'ESC-007', decision })
  expect(fLog[0]).toHaveLength(9)
  // REQ-002 routing: an escalation answer never touches recordHumanGate/driveStatus.
  expect(readLog(gatekeeperLog)).toEqual([])

  // ── REQ-005 part 1: the read-only next-action preview off `gatekeeper drive`.
  await win.getByTestId('dq-action-preview').click()
  await expect(result).toContainText('await-human', { timeout: 20_000 })
  await expect(result).toContainText(/next/i)
  await expect(result).toContainText('open escalation') // [AMENDED — FINDING-013] the carried reason renders — the load-bearing datum on every queued row
  await expect(result).not.toContainText(/resumed|advanced|dispatched|continued|unblock/i)
  const gLog = readLog(gatekeeperLog)
  expect(gLog).toHaveLength(1)
  expect(gLog[0][0]).toBe('drive')
  expect(gLog[0][1]).toBe('--feature')
  expect(gLog[0][2].toLowerCase().replace(/\\/g, '/')).toBe(`${proj}/.orky/features/demo-feature`.toLowerCase().replace(/\\/g, '/'))

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-609 REQ-014 REQ-005 resume-in-terminal: one gesture commits exactly ONE terminal pane running claude /orky:resume AT the project root (PATH-stubbed claude.cmd proves cwd + argv), zero api.orky* dispatches, a second gesture commits a second pane, and the control copy never claims an auto-run', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  // A stub `claude` on PATH (resolve-bin.ts applies PATH+PATHEXT): logs its CWD and argv — the
  // REQ-014 ground truth. Where the REAL CLI auto-executes the initial prompt is an EXTERNAL
  // contract (FINDING-005); Termhalla's pinned contract ENDS at this argv at this cwd.
  const stubBin = mkdtempSync(join(tmpdir(), 'termh-claude-stub-'))
  const claudeLog = join(stubBin, 'claude-log.txt')
  writeFileSync(join(stubBin, 'claude.cmd'),
    '@echo off\r\n' +
    '>>"%~dp0claude-log.txt" echo CWD=%CD%\r\n' +
    '>>"%~dp0claude-log.txt" echo ARGS=%*\r\n' +
    'echo stub claude session\r\n', 'utf8')

  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir, PATH: `${stubBin};${process.env.PATH ?? ''}` })
  const win = await app.firstWindow()
  await openQueue(win)

  // honest affordance copy (REQ-014): a terminal/Claude session — never a claimed resume/auto-run.
  const resume = win.getByTestId('dq-action-resume')
  const label = await resume.evaluate((el) =>
    `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`)
  expect(label).toMatch(/terminal|claude|session/i)
  expect(label).not.toMatch(/resumed|advanced|dispatched|auto-?run/i)

  // zero workspaces exist — the gesture creates one (the F6 pane-less fallback precedent), then
  // commits exactly ONE pane.
  const tiles = win.locator('[data-testid^="tile-"]')
  await expect(tiles).toHaveCount(0)
  await resume.click()
  await expect(tiles).toHaveCount(1, { timeout: 20_000 })

  // the launch ground truth: cwd is the entry's projectRoot, argv is exactly /orky:resume.
  await expect.poll(() => (existsSync(claudeLog) ? readFileSync(claudeLog, 'utf8') : ''), { timeout: 20_000 })
    .toContain('ARGS=')
  const lines1 = readFileSync(claudeLog, 'utf8').split(/\r?\n/).filter(Boolean)
  expect(lines1.filter((l) => l.startsWith('CWD='))).toHaveLength(1)   // ONE pane per gesture
  expect(lines1[0].slice('CWD='.length).toLowerCase()).toBe(proj.toLowerCase())
  expect(lines1[1]).toBe('ARGS=/orky:resume')

  // resume is a pane commit, never an Orky action (REQ-005 part 2): no CLI dispatch happened.
  expect(readLog(feedbackLog)).toEqual([])
  expect(readLog(gatekeeperLog)).toEqual([])

  // a second gesture commits a SECOND pane (no dedupe — launchDir parity), still one per gesture.
  await resume.click()
  await expect(tiles).toHaveCount(2, { timeout: 20_000 })
  await expect.poll(() => readFileSync(claudeLog, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('CWD=')).length,
    { timeout: 20_000 }).toBe(2)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-610 REQ-015 pointer isolation on a hasPane row: clicking the answer control and clicking+typing into the inline input never fire the row\'s focus-project gesture (focus stays in the actions region), while a ROW-BODY click still focuses the matched pane', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = mkdtempSync(join(tmpdir(), 'termh-dqa-ud-'))  // NO persisted registry — membership via the pane
  const app = await launch(userData)
  const win = await app.firstWindow()
  await openTerminalAt(win, proj)                                 // the hasPane row shape (unguarded onClick)
  await openQueue(win)
  await expect(win.getByTestId('decision-queue-open-terminal')).toHaveCount(0) // hasPane confirmed

  // opening the answer flow must NOT bubble into focusProject → the matched xterm pane.
  await win.getByTestId('dq-action-answer').click()
  await expect(win.locator('textarea.xterm-helper-textarea')).not.toBeFocused()

  // clicking + typing into the inline input keeps focus INSIDE the actions region: the input
  // receives the text; keyboard focus is never yanked into the pane (FINDING-001's steal vector).
  const input = win.getByTestId('dq-action-answer-input')
  await input.click()
  await win.keyboard.type('why option B works')
  expect(await focusedTestId(win)).toBe('dq-action-answer-input')
  await expect(input).toHaveValue('why option B works')
  await expect(win.locator('textarea.xterm-helper-textarea')).not.toBeFocused()

  // the row's OWN activation surface keeps working (the guard never makes the row inert): a click
  // on the row BODY (top-left padding, outside the actions region) focuses the matched pane —
  // the same body-point the amended frozen TEST-366 pins.
  await win.locator('[data-testid="decision-queue-item"]').click({ position: { x: 12, y: 10 } })
  await expect(win.locator('textarea.xterm-helper-textarea')).toBeFocused({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-611 REQ-002 REQ-004 REQ-008 the disabled-feedback path: emit answers mode:noop, the dispatcher falls back to gatekeeper resolve-escalation carrying the BOUND id and the decision byte-verbatim as discrete argv elements; the rendered success stays honest', async () => {
  test.setTimeout(120_000)
  const { proj } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('disabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  const decision = 'pass — evidence recorded in the review notes ✔'
  await win.getByTestId('dq-action-answer-input').fill(decision)
  await win.getByTestId('dq-action-answer-submit').click()

  const result = win.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/answered|submitted/i)
  await expect(result).not.toContainText(/done|complete/i)

  // the fallback chain: ONE emit (refused as disabled), then ONE gatekeeper resolve-escalation
  // whose argv carries the bound id + the decision VERBATIM (REQ-003/REQ-004 on the fallback path).
  expect(readLog(feedbackLog)).toHaveLength(1)
  const gLog = readLog(gatekeeperLog)
  expect(gLog).toHaveLength(1)
  expect(gLog[0][0]).toBe('resolve-escalation')
  expect(gLog[0][1]).toBe('--feature')
  expect(gLog[0][2].toLowerCase().replace(/\\/g, '/')).toBe(`${proj}/.orky/features/demo-feature`.toLowerCase().replace(/\\/g, '/'))
  expect(gLog[0].slice(3)).toEqual(['--id', 'ESC-007', '--decision', decision])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-612 REQ-003 the display→submit race: the bound ESC-007 is resolved (ESC-009 opens) after the answer UI bound it — the submit-time re-verification refuses, NOTHING dispatches, the honest changed/re-open message renders, and ESC-009 is never silently substituted', async () => {
  test.setTimeout(120_000)
  const { proj, statePath } = seedEscalatedProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await openQueue(win)

  // display-time binding: ESC-007 shown beside the input.
  await win.getByTestId('dq-action-answer').click()
  await expect(win.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })

  // the world changes while the human types: ESC-007 gets resolved elsewhere; ESC-009 opens.
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  writeFileSync(statePath, JSON.stringify({
    feature: 'demo-feature', phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [
      { id: 'ESC-007', status: 'resolved', reason: 'pick option A or B' },
      { id: 'ESC-009', status: 'open', reason: 'a different, newer question' }
    ]
  }), 'utf8')
  await win.waitForTimeout(1500)                                  // let the watcher settle

  await win.getByTestId('dq-action-answer-input').fill('this decision must not land anywhere')
  await win.getByTestId('dq-action-answer-submit').click()

  // the honest refusal: no dispatch (spy-count-0 equivalent — BOTH stub logs stay empty), the
  // changed/re-open class message, no substituted target.
  const err = win.getByTestId('dq-action-error')
  await expect(err).toBeVisible({ timeout: 20_000 })
  await expect(err).toContainText(/changed|re-?open/i)
  await expect(err).not.toContainText('ESC-009')
  await expect(win.getByTestId('dq-action-result')).toHaveCount(0)
  expect(readLog(feedbackLog)).toEqual([])
  expect(readLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
