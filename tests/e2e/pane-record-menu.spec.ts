// FROZEN e2e suite — feature 0002-pane-toolbar-split-control (phase 4).
// Record moves off the pane toolbar (`rec-${id}` removed) and into the title-bar right-click menu
// (`pane-menu-record`, terminal-only). Against the current code the `rec-${id}` button still exists
// and there is no `pane-menu-record`, so these assertions run RED.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

/** Right-click the title text (left side of the bar, away from the toolbar buttons). */
async function rightClickTitlebar(win: import('@playwright/test').Page, paneId: string): Promise<void> {
  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
}

// TEST-018 — REQ-001/REQ-013: the Record button is removed from the pane toolbar (count 0).
test('TEST-018 REQ-001 no rec- button in the pane toolbar', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-rec-gone-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  const paneId = tileTestId!.replace('tile-', '')

  await expect(win.getByTestId(`rec-${paneId}`)).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-019 — REQ-002: the context menu Record item reflects + controls recording state. It opens as
// "Start recording"; clicking it then re-opening the menu shows "Stop recording" (state round-trips
// through the same `recording` state the toolbar button used).
test('TEST-019 REQ-002 context-menu Record item toggles start/stop label', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-rec-menu-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  const paneId = tileTestId!.replace('tile-', '')

  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu')).toBeVisible()
  await expect(win.getByTestId('pane-menu-record')).toContainText('Start recording')
  await win.getByTestId('pane-menu-record').click() // starts recording, closes menu
  await expect(win.getByTestId('pane-menu')).toHaveCount(0)

  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu-record')).toContainText('Stop recording')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-020 — REQ-002: the Record item is terminal-only — it must NOT render for an editor pane.
test('TEST-020 REQ-002 no Record item on an editor pane context menu', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-rec-editor-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-rec-editorproj-'))
  const file = join(proj, 'x.ts'); writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })

  await rightClickTitlebar(win, 'p1')
  await expect(win.getByTestId('pane-menu')).toBeVisible()
  await expect(win.getByTestId('pane-menu-record')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
