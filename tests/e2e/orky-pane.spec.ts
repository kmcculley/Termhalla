// FROZEN e2e suite — feature 0009-native-orky-pane (phase 4). Playwright-for-Electron against out/.
// Covers what the node harness cannot reach (03-plan.md "Testability constraint"): the real
// create-pane flow through the picker, restart round-trip of the persisted binding (schema v8),
// the unbound → re-bind recovery, and REAL keyboard vectors (the F6 loopback lesson, TEST-372:
// activation must be proven with actual key presses, never only .click()).
//
//   TEST-442 — REQ-004/REQ-009: palette → picker → bound pane renders EVERY feature row (incl. the
//              clean-done feature the aggregate's popover set omits).
//   TEST-443 — REQ-002/REQ-005/REQ-001: the binding persists VERBATIM across relaunch; the saved
//              workspace file carries schemaVersion 8 and the orky pane config.
//   TEST-444 — REQ-011/REQ-018: untracked binding renders the unbound state naming the root; the
//              re-bind button is keyboard-activatable and re-binding renders the new root.
//   TEST-445 — REQ-004/REQ-018: keyboard-ONLY creation end-to-end; Escape on the picker commits
//              nothing (the pane set is unchanged).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

/** A synthetic .orky/ project: one needs-human feature (open escalation) + one CLEAN-DONE feature —
 *  the pane must render BOTH rows while the aggregate's popover set carries only the first. */
function seedOrkyProject(prefix = 'termh-orkypane-'): string {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  const escDir = join(proj, '.orky', 'features', 'esc-feature')
  mkdirSync(escDir, { recursive: true })
  writeFileSync(join(escDir, 'state.json'), JSON.stringify({
    feature: 'esc-feature', phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [{ id: 'ESC-001', status: 'open', reason: 'pick an option', at: '2026-06-30T01:00:00.000Z' }]
  }), 'utf8')
  writeFileSync(join(escDir, 'findings.json'), JSON.stringify([
    { id: 'F-1', lens: 'x', claim: 'a medium note', severity: 'MEDIUM', status: 'open' }
  ]), 'utf8')
  const doneDir = join(proj, '.orky', 'features', 'done-feature')
  mkdirSync(doneDir, { recursive: true })
  writeFileSync(join(doneDir, 'state.json'), JSON.stringify({
    feature: 'done-feature', phase: 'doc-sync',
    gates: {
      brainstorm: passed(), spec: passed(), plan: passed(), tests: passed(),
      implement: passed(), review: passed(), 'doc-sync': passed(), 'human-review': passed()
    },
    escalations: []
  }), 'utf8')
  writeFileSync(join(doneDir, 'findings.json'), JSON.stringify([]), 'utf8')
  return proj
}

function seedRegistry(userData: string, roots: string[]): void {
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
}

/** Create an orky pane via palette → picker, selecting the FIRST listed root by keyboard. */
async function createOrkyPaneViaPalette(win: Awaited<ReturnType<ElectronApplication['firstWindow']>>): Promise<void> {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
}

test('TEST-442 REQ-004 REQ-009 palette → picker → bound pane renders the FULL project status (both rows, incl. the popover-omitted clean-done feature)', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op1-'))
  const proj = seedOrkyProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  // EVERY feature renders — the clean-done one the aggregate's popover set (inPopover) excludes too
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })
  await expect(pane.locator(`[data-testid="orky-pane-feature"][data-feature="esc-feature"]`)).toHaveCount(1)
  await expect(pane.locator(`[data-testid="orky-pane-feature"][data-feature="done-feature"]`)).toHaveCount(1)
  // every row carries the reserved (F9-empty) actions slot and the (projectRoot, feature) identity
  await expect(pane.locator('[data-testid="orky-pane-row-actions"]')).toHaveCount(2)
  await expect(pane.locator(`[data-testid="orky-pane-feature"][data-project-root="${csspath(proj)}"]`)).toHaveCount(2)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-443 REQ-002 REQ-005 REQ-001 the binding persists VERBATIM across relaunch and the saved workspace carries schemaVersion 8', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op2-'))
  const proj = seedOrkyProject('termh-orkypane-persist-')
  seedRegistry(userData, [proj])

  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  await createOrkyPaneViaPalette(win)
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 20_000 })
  // force the save (palette save-all), then quit
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('save all')
  await win.getByTestId('palette-input').press('Enter')
  await win.waitForTimeout(1_000)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // the persisted workspace file: schemaVersion 8, the orky config, the root byte-verbatim
  const wsDir = join(userData, 'workspaces')
  const saved = readdirSync(wsDir).map(f => readFileSync(join(wsDir, f), 'utf8')).find(s => s.includes('"orky"'))
  expect(saved, 'a saved workspace must contain the orky pane').toBeTruthy()
  const parsed = JSON.parse(saved!) as { schemaVersion: number; workspace: { panes: Record<string, { config: { kind: string; root?: string } }> } }
  expect(parsed.schemaVersion).toBe(9) // serialization stamps the current version (9 since 0022 REQ-002)
  const orkyPane = Object.values(parsed.workspace.panes).find(p => p.config.kind === 'orky')!
  expect(orkyPane.config.root).toBe(proj) // VERBATIM, case-preserved

  // relaunch: the pane restores bound to the same root
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(win.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-444 REQ-011 REQ-018 an untracked binding renders the unbound state NAMING the root; the re-bind button is reachable and activatable by KEYBOARD and re-binding renders the new root', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op3-'))
  const projA = seedOrkyProject('termh-orkypane-a-')
  const projB = seedOrkyProject('termh-orkypane-b-')
  seedRegistry(userData, [projA])

  // bind to A, save, quit
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  await createOrkyPaneViaPalette(win)
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(projA)}"]`)).toBeVisible({ timeout: 20_000 })
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('save all')
  await win.getByTestId('palette-input').press('Enter')
  await win.waitForTimeout(1_000)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // A loses tracking (only B remains persisted) → the pane must load UNBOUND, naming A verbatim
  seedRegistry(userData, [projB])
  app = await launch(userData)
  win = await app.firstWindow()
  const unbound = win.getByTestId('orky-pane-unbound')
  await expect(unbound).toBeVisible({ timeout: 30_000 })
  await expect(unbound).toContainText(projA) // the persisted root, byte-verbatim in the copy

  // KEYBOARD path (the F6 TEST-372 lesson): Tab must REACH the re-bind button, Enter must ACTIVATE it
  await win.locator('body').click({ position: { x: 5, y: 5 } }) // deterministic focus origin
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await win.keyboard.press('Tab')
    reached = await win.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.dataset?.testid === 'orky-pane-rebind')
  }
  expect(reached, 'Tab must reach the re-bind button').toBe(true)
  await win.keyboard.press('Enter')
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(projB)}"]`)).toBeVisible({ timeout: 20_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-445 REQ-004 REQ-018 keyboard-ONLY creation succeeds end-to-end; Escape on the picker commits NOTHING', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op4-'))
  const proj = seedOrkyProject('termh-orkypane-kbd-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // Escape path FIRST: open the picker, cancel — the pane set must be unchanged
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  await expect(win.locator('[data-testid="orky-pane"]')).toHaveCount(0) // nothing committed

  // keyboard-only creation: palette (Ctrl+K), type, Enter, arrow/Enter in the focused picker
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  // CONV-020's open half: the picker holds focus, so bare key presses operate it
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// ── ESC-001 tests-loopback additions (2026-07-02) ─────────────────────────────────────────────────
//   TEST-464 — REQ-004/REQ-018 (FINDING-023): the picker's FULL keyboard matrix — Enter on the
//              Tab-focused Cancel commits NOTHING; Enter on a Tab-focused option commits THAT
//              option (never memberRoots[sel]).
//   TEST-465 — REQ-004 (decision #4c, FINDING-026/CONV-020): the compass → orky → direction →
//              picker → Escape flow commits nothing AND leaves focus on the split trigger — the
//              deliberately-restored focus is never yanked into the terminal a microtask later.
//   TEST-466 — REQ-010/REQ-022 (FINDING-013's healing half): a background-workspace pane refreshes
//              on workspace activation after fixture churn (the stale → fetch-once transition,
//              observed end-to-end; the fetch-SILENCE half is pinned at the slice/structural seams
//              in tests/renderer/orky-pane-hidden-hosts.test.ts — it is not e2e-observable).

test('TEST-464 REQ-004 REQ-018 picker keyboard matrix: Enter on the Tab-focused Cancel commits NOTHING; Enter on a Tab-focused option commits THAT option', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op5-'))
  const projA = seedOrkyProject('termh-orkypane-ka-')
  const projB = seedOrkyProject('termh-orkypane-kb-')
  seedRegistry(userData, [projA, projB])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  const openPicker = async (): Promise<void> => {
    await win.keyboard.press('Control+KeyK')
    await win.getByTestId('palette-input').fill('new orky')
    await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
    await win.getByTestId('palette-input').press('Enter')
    await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('[data-testid="orky-root-picker-item"]')).toHaveCount(2, { timeout: 10_000 })
  }
  const tabUntil = async (pred: string): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      await win.keyboard.press('Tab')
      const hit = await win.evaluate((p: string) => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return false
        if (p.startsWith('title=')) return el.getAttribute('title') === p.slice('title='.length)
        return el.dataset?.testid === p
      }, pred)
      if (hit) return true
    }
    return false
  }

  // (1) Enter on the Tab-focused CANCEL: the picker closes via Cancel and NOTHING is committed —
  //     the container-level Enter branch must not swallow the button's native activation and
  //     commit memberRoots[sel] instead (the FINDING-023 defect).
  await openPicker()
  expect(await tabUntil('orky-root-picker-cancel'), 'Tab must reach the Cancel button').toBe(true)
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  await expect(win.locator('[data-testid="orky-pane"]')).toHaveCount(0) // Cancel commits no pane, in every state

  // (2) Enter on a Tab-focused OPTION commits THAT option — target the option that is NOT the
  //     highlighted default (sel = 0), so a handler committing memberRoots[sel] is caught.
  await openPicker()
  const firstListed = await win.locator('[data-testid="orky-root-picker-item"]').first().getAttribute('title')
  const target = firstListed === projA ? projB : projA
  expect(await tabUntil(`title=${target}`), 'Tab must reach the non-default option').toBe(true)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(target)}"]`),
    'Enter on a focused option must commit THAT option, never the sel-highlighted default').toBeVisible({ timeout: 20_000 })
  await expect(win.locator('[data-testid="orky-pane"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-465 REQ-004 compass → orky → direction → picker → Escape commits nothing and leaves focus on the split trigger (CONV-020 — never yanked into the terminal a microtask later)', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op6-'))
  const proj = seedOrkyProject('termh-orkypane-cf-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 20_000 })
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  const paneId = tileTestId!.replace('tile-', '')

  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  const orkyKind = win.getByTestId(`split-kind-orky-${paneId}`)
  await expect(orkyKind, 'the orky kind button must enable once the snapshot holds a member').toBeEnabled({ timeout: 15_000 })
  await orkyKind.click()
  await win.getByTestId(`split-dir-right-${paneId}`).click()
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })

  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  // cancel after direction activation commits NOTHING: still one tile, no orky pane
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1)
  await expect(win.locator('[data-testid="orky-pane"]')).toHaveCount(0)

  // CONV-020's close half, end-to-end: the picker restored focus to the split trigger, and no
  // deferred overlay refocus may yank it into the terminal afterwards (FINDING-026's class).
  await win.waitForTimeout(150) // let any deferred microtask/refocus settle
  const focusedTestId = await win.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? document.activeElement?.tagName ?? '(none)')
  expect(focusedTestId, 'focus must remain on the split trigger after Escape — never stolen by a deferred pane refocus').toBe(`split-${paneId}`)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-466 REQ-010 REQ-022 a pane in a BACKGROUND workspace shows current data after workspace activation (fixture churn while inactive → the stale-restore refresh on switch-back)', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-op7-'))
  const proj = seedOrkyProject('termh-orkypane-bg-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  await createOrkyPaneViaPalette(win)
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })

  const ws1Tab = await win.locator('[data-testid^="tab-"]').first().getAttribute('data-tab-id')
  await win.getByTestId('new-workspace').click() // the new workspace activates; ws1 goes background

  // churn the fixture while the pane's workspace is INACTIVE: a third feature appears on disk
  const thirdDir = join(proj, '.orky', 'features', 'late-feature')
  mkdirSync(thirdDir, { recursive: true })
  writeFileSync(join(thirdDir, 'state.json'), JSON.stringify({
    feature: 'late-feature', phase: 'spec',
    gates: { brainstorm: { passed: true, at: '2026-07-01T00:00:00.000Z' } }, escalations: []
  }), 'utf8')
  await win.waitForTimeout(1_500) // engine debounce (300 ms) + re-read + notification

  // activation: the stale pane refreshes (the exactly-once count is pinned at the slice seam)
  await win.locator(`[data-testid="tab-${ws1Tab}"]`).click()
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(3, { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
