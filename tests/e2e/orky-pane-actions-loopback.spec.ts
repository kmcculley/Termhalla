// FROZEN e2e suite — feature 0010-orky-pane-inline-actions, ESC-001 tests LOOPBACK
// (review → tests, 2026-07-02). Playwright-for-Electron against out/ (`npm run build` first).
// NOT part of the `npm test` vitest gate — run explicitly and witnessed green at the review gate
// (the FINDING-016 lesson: a frozen acceptance suite no gate executes must be RUN against the
// implementation before its feature's review closes).
//
// New rendered pins the 7-lens review mandated (per the ESC-001 decision):
//
//   TEST-646 (FINDING-007 + FINDING-008, REQ-007/REQ-003) — a genuinely narrow TILE, asserted
//     against the PANE TILE's own bounding box, never window.innerWidth (the FINDING-007 lesson:
//     Playwright visibility/boundingBox checks ignore ancestor overflow clipping, and TEST-632's
//     720px window resize left the tile wider than the 340px drawer). The orky tile is split down
//     to ~a quarter of a 900px window; every dq-action-* control AND the header's
//     orky-pane-inject must sit inside the tile horizontally, and the features list must carry NO
//     horizontal scroll debt (the region WRAPS instead of overflow-scrolling).
//   TEST-647 (FINDING-009, REQ-006) — the mode-flip disarm is not SILENT and does not strand
//     focus: a data-driven escalation→null flip (the vector where the answer TOGGLE unmounts with
//     the form) that discards a non-empty typed draft surfaces the draft-lost notice through the
//     store toast chokepoint — WITH TOASTS NOT ENABLED, pinning the never-suppressed kind — and
//     keyboard focus does NOT fall to <body>. Nothing dispatches.
//   TEST-648 (FINDING-018, REQ-005) — hidden-at-settle outcome delivery: an answer dispatched
//     from the PANE mount that settles AFTER the user switches workspace (the keep-mounted-HIDDEN
//     host) must still surface its outcome — the detached-outcome toast — instead of rendering
//     only into the invisible surface (the blind-duplicate-retry invite CONV-015/CONV-034 exist
//     to prevent).
//
// The gatekeeper argv log is read HANDSHAKE-AWARE from birth (readActionLog): the v0.28.0 startup
// contract handshake (src/main/services.ts → verifyOrkyContract) invokes `gatekeeper contract`
// unconditionally at boot, so "no dispatch" always means "no gatekeeper invocation OTHER than the
// startup ['contract'] handshake" (FINDING-016 — the same accounting the amended frozen suites
// now use).
//
// Runs RED today by construction: the orky-pane-row-actions slot is flex:'none' (the region
// cannot shrink → overflow-scroll), the pane header declares no flexWrap (inject clipped
// off-tile), the disarm destroys drafts silently (no toast, focus falls to body), and deliver()
// renders a hidden-at-settle outcome into the invisible pane (no toast).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

// ── stub Orky CLIs (the 0008/0010 pattern) ───────────────────────────────────────────────────────
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
    ? { ok: true, mode: 'file', id: 'IN-e2e0010L', kind: 'work.request', path: 'inbox/IN-e2e0010L.json' }
    : { ok: true, mode: 'file', id: 'FB-e2e-0010L', path: 'outbox/FB-e2e-0010L.json' }
setTimeout(() => { process.stdout.write(JSON.stringify(out), () => process.exit(0)) }, mode.delayMs || 0)
`
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
  const pluginDir = mkdtempSync(join(tmpdir(), 'termh-opal-plugin-'))
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
/** FINDING-016: the gatekeeper log minus the startup contract handshake — every excluded entry is
 *  asserted to BE exactly ['contract'] (anything else is real traffic and must never be dropped). */
function readActionLog(logPath: string): string[][] {
  const entries = readLog(logPath)
  for (const argv of entries.filter((a) => a[0] === 'contract')) {
    expect(argv, 'startup handshake traffic is exactly ["contract"]').toEqual(['contract'])
  }
  return entries.filter((a) => a[0] !== 'contract')
}

// ── fixtures (the 0010 shapes) ───────────────────────────────────────────────────────────────────
const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
const FOUR_GATES = { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() }
const ALL_GATES = {
  ...FOUR_GATES, implement: passed(), review: passed(), 'doc-sync': passed(), 'human-review': passed()
}

function writeFeature(proj: string, slug: string, state: Record<string, unknown>): string {
  const dir = join(proj, '.orky', 'features', slug)
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'state.json')
  writeFileSync(statePath, JSON.stringify(state), 'utf8')
  writeFileSync(join(dir, 'findings.json'), JSON.stringify([]), 'utf8')
  return statePath
}
function seedPaneProject(opts: { escalations?: Array<{ id: string | null; status: string; reason: string }>; withDone?: boolean; withActive?: boolean } = {}): { proj: string; escStatePath: string } {
  const proj = mkdtempSync(join(tmpdir(), 'termh-opal-proj-'))
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
  if (opts.withActive) {
    // the active-feature header span (`active: esc-feature`) — one of FINDING-008's rigid
    // nowrap spans; a fresh lastTickAt keeps the fixture un-stalled
    writeFileSync(join(proj, '.orky', 'active.json'), JSON.stringify({
      feature: '.orky/features/esc-feature', projectRoot: proj, phase: 'implement',
      lastTickAt: new Date().toISOString(), lastAction: 'escalate'
    }), 'utf8')
  }
  return { proj, escStatePath }
}

function seedUserData(roots: string[], opts?: { toasts?: boolean }): string {
  const userData = mkdtempSync(join(tmpdir(), 'termh-opal-ud-'))
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

async function createOrkyPaneViaPalette(win: Win): Promise<void> {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
}

/** Split an EDITOR pane to the right of the ORKY pane (the split-helper flow, scoped to the orky
 *  pane's OWN toolbar button — the MosaicWindow toolbar lives OUTSIDE the tile element, so the
 *  paneId is read off the tile ancestor first; editor panes need no pty). Repeated splits keep
 *  narrowing the orky tile. */
async function splitEditorRightOfOrky(win: Win, pane: ReturnType<Win['locator']>): Promise<void> {
  const paneId = await pane.evaluate(el =>
    el.closest('[data-testid^="tile-"]')?.getAttribute('data-testid')?.slice('tile-'.length) ?? '')
  expect(paneId, 'the orky pane must live inside a tile').not.toBe('')
  await win.getByTestId('split-' + paneId).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId('split-kind-editor-' + paneId).click()
  await win.getByTestId('split-dir-right-' + paneId).click()
  await expect(win.getByTestId('split-menu')).toHaveCount(0)
}

test('TEST-646 REQ-007 REQ-003 (FINDING-007/FINDING-008) a genuinely NARROW tile, asserted tile-relative: every dq-action-* control and the header orky-pane-inject sit INSIDE the pane tile\'s bounding box, the features list carries no horizontal scroll debt (the region WRAPS), and the opened answer form stays operable', async () => {
  test.setTimeout(150_000)
  const { proj } = seedPaneProject({ withActive: true })
  const userData = seedUserData([proj])
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(900, 680) })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })

  // narrow the ORKY tile to ~a quarter of the window (two rightward splits) — a real mosaic tile
  // narrower than the actions region's intrinsic single-line width (~260-280px), which is the
  // exact regime FINDING-007 showed TEST-632's 720px WINDOW resize never reaches
  await splitEditorRightOfOrky(win, pane)
  await splitEditorRightOfOrky(win, pane)
  const paneBox = (await pane.boundingBox())!
  expect(paneBox, 'the orky pane tile must be laid out').not.toBeNull()
  expect(paneBox.width, 'the vector is honest only if the TILE is genuinely narrow (narrower than the region\'s intrinsic width)').toBeLessThan(320)

  // tile-relative containment (the FINDING-007 lesson: never window.innerWidth — bounding boxes
  // ignore ancestor overflow clipping, so the assertion must compare against the TILE's box)
  const inTile = async (testid: string): Promise<void> => {
    const box = await pane.getByTestId(testid).first().boundingBox()
    expect(box, `${testid} must be laid out`).not.toBeNull()
    expect(box!.x, `${testid} must not start left of the tile`).toBeGreaterThanOrEqual(paneBox.x - 1)
    expect(box!.x + box!.width, `${testid} must not be clipped off the tile's right edge`)
      .toBeLessThanOrEqual(paneBox.x + paneBox.width + 1)
  }

  // FINDING-008: the header inject affordance is reachable — never pushed off-tile by the rigid
  // header spans (source, needs-you, active: esc-feature all render in this fixture)
  await expect(pane.getByTestId('orky-pane-inject')).toBeVisible()
  await inTile('orky-pane-inject')

  // FINDING-007: the row's action controls sit inside the tile BEFORE any interaction (scroll
  // position 0 — a click's auto-scroll must not be what "reaches" them)
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  for (const tid of ['dq-action-answer', 'dq-action-preview', 'dq-action-resume']) {
    await inTile(tid)
  }
  // …and the features list has NO horizontal scroll debt: the region wraps within the tile
  // instead of forcing the scroll container into overflow-x (the drawer-rigidity class)
  const scrollDebt = await pane.locator('[aria-label^="Orky features"]').evaluate(el =>
    el.scrollWidth - el.clientWidth)
  expect(scrollDebt, 'the features list must not scroll horizontally — the actions region must WRAP').toBeLessThanOrEqual(1)

  // the OPEN answer form wraps and stays operable in the narrow tile too
  await escRow.getByTestId('dq-action-answer').click()
  const input = escRow.getByTestId('dq-action-answer-input')
  await expect(input).toBeVisible()
  await expect(escRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007')
  for (const tid of ['dq-action-answer-target', 'dq-action-answer-input', 'dq-action-answer-submit']) {
    await inTile(tid)
  }
  const scrollDebtOpen = await pane.locator('[aria-label^="Orky features"]').evaluate(el =>
    el.scrollWidth - el.clientWidth)
  expect(scrollDebtOpen, 'the opened form must wrap within the tile as well').toBeLessThanOrEqual(1)
  await input.click()
  await win.keyboard.type('narrow but operable')
  await expect(input).toHaveValue('narrow but operable')

  // layout work dispatched nothing (handshake-aware — FINDING-016)
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-647 REQ-006 (FINDING-009) the escalation→null flip with a NON-EMPTY typed draft: the disarm surfaces the draft-lost notice through the store toast chokepoint EVEN WITH TOASTS NOT ENABLED (the never-suppressed kind), keyboard focus does NOT fall to <body> (the answer toggle unmounted with the form), and nothing dispatches', async () => {
  test.setTimeout(150_000)
  const { proj, escStatePath } = seedPaneProject({
    withDone: false,
    escalations: [{ id: 'ESC-007', status: 'open', reason: 'pick option A or B' }]
  })
  const userData = seedUserData([proj]) // toasts deliberately NOT enabled — the notice must survive suppression
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled')
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  await expect(escRow.getByTestId('dq-action-answer')).toBeVisible({ timeout: 20_000 })

  // open the answer form and type a REAL draft — the thing the flip is about to destroy
  await escRow.getByTestId('dq-action-answer').click()
  await expect(escRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007')
  await escRow.getByTestId('dq-action-answer-input').click()
  await win.keyboard.type('half-typed answer the user cares about')

  // the world flips with NO gesture: the escalation resolves elsewhere and NOTHING else needs a
  // human (phase implement, only the four early gates passed) → reason null → the answer TOGGLE
  // unmounts together with the form — the exact vector whose captured focus-restore opener is
  // gone from the document (FINDING-009's stranded-focus half)
  writeFileSync(escStatePath, JSON.stringify({
    feature: 'esc-feature', phase: 'implement', gates: FOUR_GATES,
    escalations: [{ id: 'ESC-007', status: 'resolved', reason: 'pick option A or B' }]
  }), 'utf8')
  await win.waitForTimeout(1_500) // watcher debounce + rootChanged + pane refresh

  // the disarm ran: form AND toggle unmounted (mode null offers no answer control)
  await expect(win.getByTestId('dq-action-answer-input')).toHaveCount(0, { timeout: 10_000 })
  await expect(escRow.getByTestId('dq-action-answer')).toHaveCount(0)

  // FINDING-009 pin 1: the draft loss is REPORTED — through the store toast chokepoint, visible
  // even though toasts are NOT enabled (the never-suppressed kind; toasts-slice.ts:20)
  const toast = win.getByTestId('toast')
  await expect(toast).toBeVisible({ timeout: 10_000 })
  await expect(toast).toContainText(/draft|discard|chang|closed/i)

  // FINDING-009 pin 2: keyboard focus did not fall to <body> — a fallback re-anchored it
  const onBody = await win.evaluate(() =>
    document.activeElement === null || document.activeElement === document.body)
  expect(onBody, 'focus must not be stranded on <body> after the flip (the captured opener unmounted)').toBe(false)

  // the disarm dispatched nothing (handshake-aware — FINDING-016)
  expect(readLog(feedbackLog)).toEqual([])
  expect(readActionLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-648 REQ-005 (FINDING-018) hidden-at-settle: an answer dispatched from the PANE mount that settles after the user switches workspace (keep-mounted-HIDDEN host) surfaces its outcome as the detached-outcome toast — never only into the invisible surface', async () => {
  test.setTimeout(150_000)
  const { proj } = seedPaneProject({ withDone: false })
  const userData = seedUserData([proj], { toasts: true }) // success-class outcome rides the default (suppressible) kind — enable toasts, exactly like the F8 detached-outcome e2e
  const { pluginDir, feedbackLog, gatekeeperLog } = seedPlugin('enabled', 3000) // slow flight — the switch happens mid-air
  const app = await launch(userData, { ORKY_PLUGIN_DIR: pluginDir })
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  const escRow = pane.locator('[data-testid="orky-pane-feature"][data-feature="esc-feature"]')
  await expect(escRow.getByTestId('dq-action-answer')).toBeVisible({ timeout: 20_000 })

  // dispatch the answer from the pane, then switch workspace while the flight is in the air —
  // the pane stays MOUNTED but hidden (App keeps every workspace mounted; PaneTile hides it)
  await escRow.getByTestId('dq-action-answer').click()
  await expect(escRow.getByTestId('dq-action-answer-target')).toContainText('ESC-007')
  await escRow.getByTestId('dq-action-answer-input').fill('answered, then walked away')
  await escRow.getByTestId('dq-action-answer-submit').click()
  await expect(escRow.getByTestId('dq-action-pending')).toBeVisible({ timeout: 5_000 })
  await win.getByTestId('new-workspace').click()
  await expect(pane).toBeHidden({ timeout: 10_000 })

  // the settle arrives while the owning surface is hidden: the outcome MUST surface — the same
  // store-toast chokepoint a detached (unmounted) settle already uses, same honesty class
  const toast = win.getByTestId('toast')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(toast).toContainText(/answered|submitted/i)
  await expect(toast).not.toContainText(/done|complete/i)

  // exactly ONE dispatch crossed the episode (handshake-aware — FINDING-016)
  const fLog = readLog(feedbackLog)
  expect(fLog).toHaveLength(1)
  expect(fLog[0][0]).toBe('emit')
  expect(readActionLog(gatekeeperLog)).toEqual([])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
