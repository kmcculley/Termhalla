// FROZEN e2e suite — feature 0010-orky-pane-inline-actions (phase 4; DoD acceptance).
// Playwright-for-Electron against out/ (`npm run build` first). Covers what the node harness
// cannot reach (the 0009 "Testability constraint"; real keyboard/pointer vectors per the F6
// TEST-372 lesson): the rendered pane-mount composition, the escalation-id agreement with the
// row's own displayed escalation, the pre-targeted inject flow, the id-sourcing refusal vectors
// (the TEST-612 fixture-rewrite technique applied to the pane mount), the honest cross-instance
// pane+queue model, and the CONV-046 mode-flip disarm under BOTH mounts.
//
// The dispatch chain is REAL end-to-end (the 0008 orky-queue-actions.spec.ts mechanism): gesture →
// useOrkyEntryActions → api.orky* → preload → registrar → OrkyActionDispatcher → runOrkyCli →
// STUB Orky CLIs seeded into ORKY_PLUGIN_DIR (feedback/cli.js answers emit AND submit; a
// gatekeeper/cli.js answers drive/resolve-escalation). Each stub appends its argv to its own
// argv-log.jsonl — the byte-verbatim proof surface. The escalation-id ground truth is the
// fixtured .orky/features/*/state.json the REAL registry:detail channel reads.
//
//   TEST-632 — REQ-001/002/004/007/008: the pane-mount composition end-to-end — per-row mode
//              routing (the done row offers NO answer control), zero dispatch on mount/expand/open,
//              dq-action-answer-target EQUALS the row's own first-open data-escalation-id
//              (ESC-007, never the resolved ESC-001), CONV-041/042/043/044 inside the tile, ONE
//              pinned emit argv keyed (pane root, dir slug), and narrow-tile operability.
//   TEST-633 — REQ-001/004: resume-in-terminal FROM the pane — one gesture commits exactly ONE
//              terminal pane running `claude /orky:resume` AT the pane's root (PATH-stubbed
//              claude.cmd proves cwd+argv) with ZERO api.orky* dispatches.
//   TEST-634 — REQ-003: inject — a bound pane's orky-pane-inject opens F12's capture FORM directly
//              (no picker step), pre-targeted to the pane's root byte-verbatim; the submit argv's
//              projectRoot is strictly the pane's root; the unbound state offers NO inject.
//   TEST-635 — REQ-002: the id-sourcing refusal vectors at the pane mount — the STRUCTURAL id
//              beats a free-text-named one; a null-id first-open escalation follows the shared
//              honest-refusal bind path (no dispatch); the changed-world submit refuses via the
//              TEST-612 fixture-rewrite technique with EMPTY CLI logs and no substituted id.
//   TEST-636 — REQ-005: the honest two-mount model — a queue-mount flight renders shared pending
//              on BOTH mounts, the pane mount's affordances REFUSE mid-flight, the argv log
//              settles at EXACTLY 1, the initiating mount renders the outcome while the pane
//              mount returns to idle re-enabled (no phantom result, no stuck pending).
//   TEST-637 — REQ-006 (CONV-046): a data-driven reason flip (escalation → human-review) DISARMS
//              the open answer form on BOTH mounts — the form unmounts, focus is NOT moved into
//              any field, nothing dispatches — and only an explicit re-open gesture mounts the
//              (fresh, empty) verdict form and moves focus (CONV-042).
//
// Runs RED today by construction: the shipped OrkyPane renders an EMPTY orky-pane-row-actions
// slot (no dq-action-* element in any pane row) and no orky-pane-inject affordance.
//
// [AMENDED at the ESC-001 tests LOOPBACK (review → tests), 2026-07-02 — FINDING-016 supersession
// (CONV-019)]: every raw expect(readLog(gatekeeperLog)).toEqual([]) / gatekeeper-argv-count
// assertion in TEST-632/633/635/636/637 was unsatisfiable by construction — the v0.28.0 startup
// contract handshake invokes `gatekeeper contract` at every boot with ORKY_PLUGIN_DIR set (the
// review witnessed 5/6 deterministic failures on [["contract"]]). All gatekeeper-log reads now go
// through readActionLog (below), which filters ONLY the exact ['contract'] handshake argv and
// asserts nothing else was excluded. Every assertion's intent (zero user-gesture dispatch until a
// gesture; exactly-one dispatch per episode) is preserved verbatim. TEST-634 reads only the
// feedback log and is byte-unchanged.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

// ── stub Orky CLIs (the 0008/0012 pattern; the same execFile(process.execPath, [cli.js, …])) ─────
/** feedback stub: logs argv; answers `submit` with the 0012 receipt shape and `emit` with the
 *  0008 receipt shape — so both the answer path and the inject→capture path prove their argv here. */
const FEEDBACK_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { behavior: 'enabled', delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const out = mode.behavior === 'disabled'
  ? { ok: true, mode: 'noop' }
  : args[0] === 'submit'
    ? { ok: true, mode: 'file', id: 'IN-e2e0010', kind: 'work.request', path: 'inbox/IN-e2e0010.json' }
    : { ok: true, mode: 'file', id: 'FB-e2e-0010', path: 'outbox/FB-e2e-0010.json' }
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`
/** gatekeeper stub: logs argv; `drive` answers the REAL shape (the 0008 FINDING-013 lesson). */
const GATEKEEPER_STUB = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const sub = args[0]
const out = sub === 'drive' ? { next: 'await-human', reason: 'open escalation', escalations: ['ESC-007'] }
  : sub === 'resolve-escalation' ? { id: 'ESC-007', status: 'resolved' }
  : {}
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`

interface Plugin { pluginDir: string; feedbackLog: string; gatekeeperLog: string }
function seedPlugin(behavior: 'enabled' | 'disabled', delayMs = 0): Plugin {
  const pluginDir = mkdtempSync(join(tmpdir(), 'termh-opa-plugin-'))
  for (const kind of ['feedback', 'gatekeeper'] as const) {
    mkdirSync(join(pluginDir, kind), { recursive: true })
    writeFileSync(join(pluginDir, kind, 'cli.js'), kind === 'feedback' ? FEEDBACK_STUB : GATEKEEPER_STUB, 'utf8')
    writeFileSync(join(pluginDir, kind, 'mode.json'), JSON.stringify({ behavior, delayMs }), 'utf8')
  }
  return {
    pluginDir,
    feedbackLog: join(pluginDir, 'feedback', 'argv-log.jsonl'),
    gatekeeperLog: join(pluginDir, 'gatekeeper', 'argv-log.jsonl')
  }
}
function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
/** [AMENDED at feature 0010's ESC-001 tests LOOPBACK, 2026-07-02 — FINDING-016 supersession
 *  (CONV-019; CONV-012 co-ownership where this file is F8's)]: the v0.28.0 startup contract
 *  handshake (src/main/services.ts → verifyOrkyContract, commit 0dc4c54) invokes
 *  `gatekeeper contract` unconditionally at boot whenever ORKY_PLUGIN_DIR is set, so a RAW
 *  emptiness assertion over the gatekeeper argv log was unsatisfiable by construction — against a
 *  behaviorally CORRECT implementation. This reader asserts every handshake entry IS exactly
 *  ['contract'] (anything else is real traffic and is never dropped) and returns the log WITHOUT
 *  them. Every gatekeeper-log assertion in this file now reads through it: the pinned intent — no
 *  user-gesture dispatch until a gesture — is preserved verbatim; only the unconditional startup
 *  handshake is accounted for. */
function readActionLog(logPath: string): string[][] {
  const entries = readLog(logPath)
  for (const argv of entries.filter((a) => a[0] === 'contract')) {
    expect(argv, 'startup handshake traffic is exactly ["contract"]').toEqual(['contract'])
  }
  return entries.filter((a) => a[0] !== 'contract')
}

// ── fixtures: synthetic .orky/ projects the REAL registry:detail channel reads ───────────────────
const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
const FOUR_GATES = { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() }
const ALL_GATES = {
  ...FOUR_GATES, implement: passed(), review: passed(), 'doc-sync': passed(), 'human-review': passed()
}

type EscFixture = { id: string | null; status: string; reason: string }
function writeFeature(proj: string, slug: string, state: Record<string, unknown>): string {
  const dir = join(proj, '.orky', 'features', slug)
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'state.json')
  writeFileSync(statePath, JSON.stringify(state), 'utf8')
  writeFileSync(join(dir, 'findings.json'), JSON.stringify([]), 'utf8')
  return statePath
}
/** The 0009 two-feature shape (a needs-you escalation row + a clean-done row), with the 0008
 *  first-open selection twist: a RESOLVED escalation sits FIRST, the open ESC-007 second. */
function seedPaneProject(opts: { escalations?: EscFixture[]; withDone?: boolean } = {}): { proj: string; escStatePath: string } {
  const proj = mkdtempSync(join(tmpdir(), 'termh-opa-proj-'))
  const escalations = opts.escalations ?? [
    { id: 'ESC-001', status: 'resolved', reason: 'an earlier, already-answered question' },
    { id: 'ESC-007', status: 'open', reason: 'pick option A or B' }
  ]
  const escStatePath = writeFeature(proj, 'esc-feature', {
    feature: 'esc-feature', phase: 'implement', gates: FOUR_GATES, escalations
  })
  if (opts.withDone !== false) {
    writeFeature(proj, 'done-feature', {
      feature: 'done-feature', phase: 'doc-sync', gates: ALL_GATES, escalations: []
    })
  }
  return { proj, escStatePath }
}

function seedUserData(roots: string[]): string {
  const userData = mkdtempSync(join(tmpdir(), 'termh-opa-ud-'))
  seedRegistry(userData, roots)
  return userData
}
function seedRegistry(userData: string, roots: string[]): void {
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
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

/** Create an orky pane via palette → picker (the 0009 TEST-442 flow), first listed root. */
async function createOrkyPaneViaPalette(win: Win): Promise<void> {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
}

async function openQueue(win: Win): Promise<void> {
  await expect(win.getByTestId('orky-queue-toggle')).toBeVisible({ timeout: 20_000 })
  await win.getByTestId('orky-queue-toggle').click()
  await expect(win.locator('[data-testid="decision-queue-item"]')).toHaveCount(1, { timeout: 20_000 })
}

test('TEST-632 REQ-001/002/004/007/008 the pane-mount composition end-to-end: per-row mode routing, zero dispatch until a gesture, dq-action-answer-target EQUALS the row\'s own first-open data-escalation-id, CONV-041/042/043/044 inside the tile, ONE pinned emit argv keyed on (pane root, dir slug), and narrow-tile operability [AMENDED — FINDING-016: gatekeeper log read handshake-aware via readActionLog]', async () => {
  test.setTimeout(150_000)
  const { proj } = seedPaneProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled', 1000)
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  const doneRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="done-feature"]')

  // REQ-001: EVERY row mounts the region; the SHARED mode routing decides per-row affordances —
  // the escalation row offers answer+preview+resume, the clean-done row preview+resume but NO
  // answer control (reason null), and no verdict chrome anywhere.
  await expect(escRow.getByTestId('dq-action-answer')).toBeVisible()
  await expect(escRow.getByTestId('dq-action-preview')).toBeVisible()
  await expect(escRow.getByTestId('dq-action-resume')).toBeVisible()
  await expect(doneRow.getByTestId('dq-action-preview')).toBeVisible()
  await expect(doneRow.getByTestId('dq-action-resume')).toBeVisible()
  await expect(doneRow.getByTestId('dq-action-answer')).toHaveCount(0)
  await expect(win.getByTestId('dq-action-verdict-pass')).toHaveCount(0)
  // REQ-004: merely mounting the pane dispatched NOTHING.
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  // REQ-008: the displayed-escalation agreement — expand the row so its OWN escalation renders.
  const toggle = escRow.locator('button[aria-expanded]')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(escRow.locator('[data-testid="orky-pane-escalation"][data-escalation-id="ESC-007"]')).toHaveCount(1)
  expect(readLog(feedbackLog)).toEqual([]) // expanding dispatched nothing either (REQ-004)

  // CONV-042 + REQ-002/REQ-008: the answer-open gesture lands focus in the decision input, and the
  // bound target IS the row's first-open id (ESC-007 — never the resolved ESC-001), rendered with
  // zero dispatch (the supplied-id path binds from the already-held detail).
  await escRow.getByTestId('dq-action-answer').click()
  const target = escRow.getByTestId('dq-action-answer-target')
  await expect(target).toBeVisible()
  await expect(target).toContainText('ESC-007')
  await expect(target).not.toContainText('ESC-001')
  expect(await focusedTestId(win)).toBe('dq-action-answer-input')
  expect(readLog(feedbackLog)).toEqual([])

  // CONV-041: clicking + typing inside the region never fires a host gesture — the row's
  // disclosure state is untouched and focus stays in the input.
  const input = escRow.getByTestId('dq-action-answer-input')
  await input.click()
  await win.keyboard.type('take option B')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(await focusedTestId(win)).toBe('dq-action-answer-input')

  // CONV-043's refusal half: an empty/whitespace decision cannot dispatch — by button OR Enter.
  await input.fill('   ')
  await expect(escRow.getByTestId('dq-action-answer-submit')).toBeDisabled()
  await input.press('Enter')
  expect(readLog(feedbackLog)).toEqual([])

  // CONV-043 + REQ-001: Enter in the non-empty decision input dispatches ONCE, keyed on the
  // PANE's identity — projectRoot = the pane's root, feature = the row's dir slug.
  const decision = 'Take option B — answered from the pane ✔'
  await input.fill(decision)
  await input.press('Enter')
  await expect(escRow.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })
  await expect(escRow.getByTestId('dq-action-answer-submit')).toBeDisabled()
  const result = escRow.getByTestId('dq-action-result')
  await expect(result).toBeVisible({ timeout: 20_000 })
  await expect(result).toContainText(/answered|submitted/i)
  await expect(result).not.toContainText(/done|complete/i)
  const fLog = readLog(feedbackLog)
  expect(fLog).toHaveLength(1)
  expect(fLog[0].slice(0, 7)).toEqual(['emit', '--app', proj, '--type', 'decision', '--feature', 'esc-feature'])
  expect(JSON.parse(fLog[0][8])).toEqual({ escalationId: 'ESC-007', decision })
  expect(readActionLog(gatekeeperLog)).toEqual([])

  // CONV-044: the succeeded answer disarms — the form is closed.
  await expect(escRow.getByTestId('dq-action-answer-input')).toHaveCount(0)

  // REQ-007: a NARROW tile (a real window resize — the tile is not the 340px drawer): the
  // controls stay visible and operable, and re-opening shows a FRESH empty input (CONV-044's
  // re-arm) that wraps within the viewport instead of clipping.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(720, 640) })
  await expect(escRow.getByTestId('dq-action-answer')).toBeVisible()
  await expect(escRow.getByTestId('dq-action-preview')).toBeVisible()
  await expect(escRow.getByTestId('dq-action-resume')).toBeVisible()
  await escRow.getByTestId('dq-action-answer').click()
  const input2 = escRow.getByTestId('dq-action-answer-input')
  await expect(input2).toBeVisible()
  expect(await input2.inputValue()).toBe('')
  await input2.click()
  await win.keyboard.type('still operable when narrow')
  await expect(input2).toHaveValue('still operable when narrow')
  const width = await win.evaluate(() => window.innerWidth)
  for (const tid of ['dq-action-answer', 'dq-action-preview', 'dq-action-resume', 'dq-action-answer-input']) {
    const box = await escRow.getByTestId(tid).boundingBox()
    expect(box, `${tid} must be laid out`).not.toBeNull()
    expect(box!.x + box!.width, `${tid} must not be clipped off the narrow tile`).toBeLessThanOrEqual(width + 1)
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-633 REQ-001 REQ-004 resume-in-terminal FROM the pane: one gesture commits exactly ONE terminal pane running claude /orky:resume AT the pane\'s root (PATH-stubbed claude.cmd proves cwd + argv), with ZERO api.orky* dispatches [AMENDED — FINDING-016: gatekeeper log read handshake-aware via readActionLog]', async () => {
  test.setTimeout(120_000)
  const { proj } = seedPaneProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const stubBin = mkdtempSync(join(tmpdir(), 'termh-opa-claude-'))
  const claudeLog = join(stubBin, 'claude-log.txt')
  writeFileSync(join(stubBin, 'claude.cmd'),
    '@echo off\r\n' +
    '>>"%~dp0claude-log.txt" echo CWD=%CD%\r\n' +
    '>>"%~dp0claude-log.txt" echo ARGS=%*\r\n' +
    'echo stub claude session\r\n', 'utf8')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir, PATH: `${stubBin};${process.env.PATH ?? ''}` })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')

  // the orky pane is the only tile so far; the resume gesture commits exactly ONE more.
  const tiles = win.locator('[data-testid^="tile-"]')
  await expect(tiles).toHaveCount(1)
  await escRow.getByTestId('dq-action-resume').click()
  await expect(tiles).toHaveCount(2, { timeout: 20_000 })

  // the F8 REQ-014 contract, unchanged: cwd = the PANE's root, argv = exactly /orky:resume.
  await expect.poll(() => (existsSync(claudeLog) ? readFileSync(claudeLog, 'utf8') : ''), { timeout: 20_000 })
    .toContain('ARGS=')
  const lines = readFileSync(claudeLog, 'utf8').split(/\r?\n/).filter(Boolean)
  expect(lines.filter((l) => l.startsWith('CWD='))).toHaveLength(1)
  expect(lines[0].slice('CWD='.length).toLowerCase()).toBe(proj.toLowerCase())
  expect(lines[1]).toBe('ARGS=/orky:resume')

  // resume is a pane commit, never an Orky dispatch (REQ-004): both stub logs stay empty.
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-634 REQ-003 inject: a bound pane\'s orky-pane-inject opens the capture FORM directly (no picker step) pre-targeted to the pane\'s root with F12\'s own title focus; submitting dispatches orkySubmitWork with projectRoot STRICTLY the pane\'s root; the gesture itself dispatches nothing; the unbound state offers NO inject', async () => {
  test.setTimeout(150_000)
  const { proj } = seedPaneProject()
  const { proj: other } = seedPaneProject()
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog } = seedPlugin('enabled')

  let app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  let win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })

  // PANE-scoped, not row-scoped (resolved decision #3): exactly ONE inject affordance, honestly
  // labeled — it captures/injects work FOR this project and claims no submission by itself.
  const inject = pane.getByTestId('orky-pane-inject')
  await expect(inject).toBeVisible()
  await expect(pane.locator('[data-testid="orky-pane-inject"]')).toHaveCount(1)
  const label = await inject.evaluate((el) =>
    `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`)
  expect(label).toMatch(/capture|inject|work/i)
  expect(label).not.toMatch(/submitted|saved|written/i)

  // the gesture opens the capture FORM directly — pre-targeted, NO picker step, title focused per
  // F12's own contract — and dispatches nothing by itself.
  await inject.click()
  await expect(win.getByTestId('orky-capture')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  await expect(win.getByTestId('orky-capture-target')).toHaveText(proj)
  expect(await focusedTestId(win)).toBe('orky-capture-title')
  expect(readLog(feedbackLog)).toEqual([])

  // typing a title and submitting dispatches orkySubmitWork with projectRoot === the pane's root.
  const title = 'idea captured from the pane'
  await win.keyboard.type(title)
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-capture')).toHaveCount(0, { timeout: 15_000 })
  const log = readLog(feedbackLog)
  expect(log).toHaveLength(1)
  expect(log[0][0]).toBe('submit')
  expect(log[0][1]).toBe('--app')
  expect(log[0][2]).toBe(proj) // BYTE-VERBATIM — never re-cased/re-slashed
  expect(JSON.parse(log[0][4]).title).toBe(title)

  // persist the pane, then relaunch with the root UNTRACKED: the unbound state offers no inject.
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('save all')
  await win.getByTestId('palette-input').press('Enter')
  await win.waitForTimeout(1_000)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  seedRegistry(userData, [other])
  app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  win = await app.firstWindow()
  await expect(win.getByTestId('orky-pane-unbound')).toBeVisible({ timeout: 30_000 })
  await expect(win.locator('[data-testid="orky-pane-inject"]')).toHaveCount(0)
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-635 REQ-002 the id-sourcing refusal vectors at the pane mount: the STRUCTURAL id beats a free-text-named one; a null-id first-open escalation rides the shared honest-refusal bind path (no dispatch); the changed-world submit refuses via the fixture-rewrite technique with EMPTY CLI logs and no substituted id [AMENDED — FINDING-016: gatekeeper log read handshake-aware via readActionLog]', async () => {
  test.setTimeout(150_000)
  const proj = mkdtempSync(join(tmpdir(), 'termh-opa-proj-'))
  // esc-feature: the free text names ESC-999; the STRUCTURAL first-open id is ESC-007.
  const escStatePath = writeFeature(proj, 'esc-feature', {
    feature: 'esc-feature', phase: 'implement', gates: FOUR_GATES,
    escalations: [
      { id: 'ESC-001', status: 'resolved', reason: 'an earlier, already-answered question' },
      { id: 'ESC-007', status: 'open', reason: 'blocked — see ESC-999 for context' }
    ]
  })
  // nullid-feature: the first (only) open escalation carries NO usable id.
  writeFeature(proj, 'nullid-feature', {
    feature: 'nullid-feature', phase: 'implement', gates: FOUR_GATES,
    escalations: [{ id: null, status: 'open', reason: 'an escalation recorded without an id' }]
  })
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  const nullRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="nullid-feature"]')

  // ── vector 1: the STRUCTURAL id wins. The row's own rendered escalation proves the free text
  // names a DIFFERENT id (ESC-999) — the bound target still carries ESC-007.
  await escRow.locator('button[aria-expanded]').click()
  await expect(escRow.locator('[data-testid="orky-pane-escalation"][data-escalation-id="ESC-007"]')).toContainText('ESC-999')
  await escRow.getByTestId('dq-action-answer').click()
  const target = escRow.getByTestId('dq-action-answer-target')
  await expect(target).toBeVisible()
  await expect(target).toContainText('ESC-007')
  await expect(target).not.toContainText('ESC-999')

  // ── vector 2: the null-id row OMITS escalationId and follows the shared one-pull honest-refusal
  // bind path unmodified — the refusal renders, the submit refuses, and the CLI is never invoked.
  await nullRow.getByTestId('dq-action-answer').click()
  const nullErr = nullRow.getByTestId('dq-action-error')
  await expect(nullErr).toBeVisible({ timeout: 10_000 })
  await expect(nullErr).toHaveAttribute('data-error-kind', 'escalation-unbound')
  await expect(nullRow.getByTestId('dq-action-answer-submit')).toBeDisabled()
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  // ── vector 3: the changed world (the TEST-612 technique at the PANE mount). ESC-007 resolves
  // and ESC-010 opens while the human types — the submit-time re-verification refuses, NOTHING
  // dispatches, and the newly-open id is never silently substituted.
  writeFileSync(escStatePath, JSON.stringify({
    feature: 'esc-feature', phase: 'implement', gates: FOUR_GATES,
    escalations: [
      { id: 'ESC-007', status: 'resolved', reason: 'blocked — see ESC-999 for context' },
      { id: 'ESC-010', status: 'open', reason: 'a different, newer question' }
    ]
  }), 'utf8')
  await win.waitForTimeout(1_500) // let the watcher + pane refresh settle
  await escRow.getByTestId('dq-action-answer-input').fill('this decision must not land anywhere')
  await escRow.getByTestId('dq-action-answer-submit').click()
  const err = escRow.getByTestId('dq-action-error')
  await expect(err).toBeVisible({ timeout: 20_000 })
  await expect(err).toContainText(/changed|re-?open/i)
  await expect(err).not.toContainText('ESC-010')
  await expect(escRow.getByTestId('dq-action-result')).toHaveCount(0)
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-636 REQ-005 the honest two-mount model: a flight started on the QUEUE mount renders shared pending on BOTH mounts, the PANE mount\'s affordances refuse mid-flight, the argv log settles at EXACTLY 1, the initiating mount renders the outcome and the pane mount returns to idle re-enabled — never a phantom result, never stuck pending [AMENDED — FINDING-016: gatekeeper log read handshake-aware via readActionLog]', async () => {
  test.setTimeout(150_000)
  const { proj } = seedPaneProject({ withDone: false })
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled', 3000) // slow flight — the mid-flight window is real
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // BOTH mounts of the SAME (projectRoot, featureSlug): the pane first, then the queue drawer.
  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  await expect(escRow.getByTestId('dq-action-preview')).toBeVisible({ timeout: 20_000 })
  await openQueue(win)
  const queueRow = win.locator('[data-testid="decision-queue-item"]')

  // pre-open the pane's answer form so its submit refusal is observable mid-flight.
  await escRow.getByTestId('dq-action-answer').click()
  await expect(escRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007')
  await escRow.getByTestId('dq-action-answer-input').fill('ready to answer from the pane')
  await expect(escRow.getByTestId('dq-action-answer-submit')).toBeEnabled()
  expect(readActionLog(gatekeeperLog)).toEqual([])

  // the flight starts on the QUEUE mount (the read-only preview — a real gatekeeper drive).
  await queueRow.getByTestId('dq-action-preview').click()

  // (1) DURING the flight: the shared pending renders in BOTH regions (the module-scope registry
  // via subscribeFlights — the F8 seam, inherited, not reimplemented).
  await expect(queueRow.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })
  await expect(escRow.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })
  // (2) the NON-INITIATING (pane) mount's dispatch affordances refuse on the same shared busy —
  // a second gesture cannot start a second dispatch (the frozen TEST-608 gates, cross-mount).
  await expect(escRow.getByTestId('dq-action-preview')).toBeDisabled()
  await expect(escRow.getByTestId('dq-action-answer-submit')).toBeDisabled()

  // (4) after settle: the INITIATING mount renders the settled outcome via its own continuation;
  // the pane mount — whose gesture never fired — renders NEITHER result NOR error and returns to
  // idle with its controls re-enabled.
  await expect(queueRow.getByTestId('dq-action-result')).toBeVisible({ timeout: 20_000 })
  await expect(queueRow.getByTestId('dq-action-result')).toContainText('await-human')
  await expect(escRow.getByTestId('dq-action-result')).toHaveCount(0)
  await expect(escRow.getByTestId('dq-action-error')).toHaveCount(0)
  await expect(escRow.getByTestId('dq-action-pending')).toHaveCount(0)
  await expect(escRow.getByTestId('dq-action-preview')).toBeEnabled()
  await expect(escRow.getByTestId('dq-action-answer-submit')).toBeEnabled()

  // (3) the wire truth: EXACTLY one dispatch crossed the whole two-mount episode.
  const gLog = readActionLog(gatekeeperLog)
  expect(gLog).toHaveLength(1)
  expect(gLog[0][0]).toBe('drive')
  expect(readLog(feedbackLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-637 REQ-006 CONV-046: a data-driven reason flip (escalation → human-review) DISARMS the open answer form on BOTH mounts — the form region unmounts, keyboard focus is NOT moved into any field, nothing dispatches — and only an explicit re-open gesture mounts the fresh, EMPTY verdict form and moves focus (CONV-042) [AMENDED — FINDING-016: gatekeeper log read handshake-aware via readActionLog]', async () => {
  test.setTimeout(150_000)
  const { proj, escStatePath } = seedPaneProject({
    withDone: false,
    escalations: [{ id: 'ESC-007', status: 'open', reason: 'pick option A or B' }]
  })
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  await expect(escRow.getByTestId('dq-action-answer')).toBeVisible({ timeout: 20_000 })
  await openQueue(win)
  const queueRow = win.locator('[data-testid="decision-queue-item"]')

  // open the answer form on BOTH mounts and type a draft in each (the flip must clear both).
  await queueRow.getByTestId('dq-action-answer').click()
  await expect(queueRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007', { timeout: 10_000 })
  await queueRow.getByTestId('dq-action-answer-input').fill('queue draft')
  await escRow.getByTestId('dq-action-answer').click()
  await expect(escRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007')
  await escRow.getByTestId('dq-action-answer-input').click()
  await win.keyboard.type('pane draft')
  await expect(win.getByTestId('dq-action-answer-input')).toHaveCount(2)

  // the world flips with NO gesture: the escalation resolves elsewhere and the human-review gate
  // becomes the frontier — target.reason flips 'escalation' → 'human-review' on the next refresh.
  writeFileSync(escStatePath, JSON.stringify({
    feature: 'esc-feature', phase: 'doc-sync',
    gates: {
      brainstorm: passed(), spec: passed(), plan: passed(), tests: passed(),
      implement: passed(), review: passed(), 'doc-sync': passed()
    },
    escalations: [{ id: 'ESC-007', status: 'resolved', reason: 'pick option A or B' }]
  }), 'utf8')
  await win.waitForTimeout(1_500) // watcher debounce + rootChanged + both mounts refresh

  // CONV-046: the flip DISARMS instead of swapping the focus-on-mount substrate — on BOTH mounts
  // the form region unmounts: no decision input, no evidence input anywhere in the window.
  await expect(win.getByTestId('dq-action-answer-input')).toHaveCount(0, { timeout: 10_000 })
  await expect(win.getByTestId('dq-action-evidence')).toHaveCount(0)
  // keyboard focus was NOT moved into any form field by the data-driven flip.
  const activeTag = await win.evaluate(() => document.activeElement?.tagName ?? '')
  expect(['INPUT', 'TEXTAREA']).not.toContain(activeTag)
  // the disarm dispatched nothing.
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  // re-arming is an EXPLICIT gesture (CONV-042): re-opening on the pane mounts the human-review
  // form FRESH — the previously typed decision is gone, the evidence input is empty, and focus
  // moves only NOW, on the open gesture itself.
  await escRow.getByTestId('dq-action-answer').click()
  const evidence = escRow.getByTestId('dq-action-evidence')
  await expect(evidence).toBeVisible()
  expect(await evidence.inputValue()).toBe('')
  expect(await focusedTestId(win)).toBe('dq-action-evidence')
  await expect(escRow.getByTestId('dq-action-verdict-pass')).toBeVisible()
  await expect(escRow.getByTestId('dq-action-verdict-fail')).toBeVisible()
  expect(readLog(feedbackLog)).toEqual([]) // still nothing dispatched — opening is never a write

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
