// FROZEN e2e suite — feature 0003-pane-minimize-restore (phase 4 / REQ-007 + REQ-008).
// Persisted view-state must survive a reload: a minimized pane stays minimized; a maximized pane
// stays maximized. Each test creates two terminals, sets view-state, saves, relaunches against the
// same user-data-dir, and asserts the state was restored from disk. Runs RED until the feature ships.
// Requires `npm run build` first.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitSecondTerminal } from './split-helper'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function tileIds(win: Page): Promise<string[]> {
  return win.locator('[data-testid^="tile-"]').evaluateAll(els =>
    els.map(e => ((e as { getAttribute(n: string): string | null }).getAttribute('data-testid') || '').replace('tile-', '')))
}
async function twoTerminals(win: Page): Promise<string[]> {
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await splitSecondTerminal(win)
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  return tileIds(win)
}

// TEST-031 — REQ-007: a pane minimized before reload is still minimized after reload (in the tray,
// absent from the visible layout), with its pane config preserved.
test('TEST-031 REQ-007 a minimized pane stays minimized across a reload', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-min-persist-'))

  let app = await launch(userData)
  let win = await app.firstWindow()
  const ids = await twoTerminals(win)
  await win.getByTestId(`min-${ids[0]}`).click()
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(900) // flush the save IPC to disk
  killTree(app.process().pid); await app.close().catch(() => {})

  app = await launch(userData)
  win = await app.firstWindow()
  // Restored from disk: the other pane is visible, the minimized one is in the tray, not tiled.
  await expect(win.getByTestId(`tile-${ids[1]}`)).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`tile-${ids[0]}`)).toHaveCount(0)

  killTree(app.process().pid); await app.close().catch(() => {})
})

// TEST-032 — REQ-008: maximize view-state (formerly transient) is now persisted — a maximized pane
// stays maximized after reload, so its sibling remains hidden (if maximize were NOT persisted, both
// panes would tile back visible on reload).
test('TEST-032 REQ-008 a maximized pane stays maximized across a reload', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-max-persist-'))

  let app = await launch(userData)
  let win = await app.firstWindow()
  const ids = await twoTerminals(win)
  await win.getByTestId(`max-${ids[0]}`).click()
  await expect(win.getByTestId(`tile-${ids[1]}`)).not.toBeVisible() // sibling hidden by maximize
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(900)
  killTree(app.process().pid); await app.close().catch(() => {})

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.getByTestId(`tile-${ids[0]}`)).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId(`tile-${ids[1]}`)).not.toBeVisible({ timeout: 10_000 }) // still maximized

  killTree(app.process().pid); await app.close().catch(() => {})
})
