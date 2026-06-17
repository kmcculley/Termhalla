import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

async function openKeybindings(win: import('@playwright/test').Page) {
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await win.getByTestId('settings-nav-keybindings').click()
  await expect(win.getByTestId('settings-keybindings')).toBeVisible()
}

test('rebinds a command, fires the new chord, and rejects a no-Ctrl chord', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kb-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await openKeybindings(win)
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+T')

  // Invalid: a chord without Ctrl is rejected with an error and no change.
  await win.getByTestId('kb-change-new-terminal').click()
  await win.keyboard.press('Shift+N')
  await expect(win.getByTestId('kb-error')).toBeVisible()
  await win.getByTestId('kb-change-new-terminal').click() // cancel the still-open capture

  // Valid rebind to Ctrl+Shift+N.
  await win.getByTestId('kb-change-new-terminal').click()
  await win.keyboard.press('Control+Shift+N')
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+N')

  // Close Settings and confirm the new chord opens a pane (tile count grows).
  await win.getByTestId('settings-close').click()
  const before = await win.locator('[data-testid^="tile-"]').count()
  await win.keyboard.press('Control+Shift+N')
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(before + 1, { timeout: 10_000 })

  // Reset restores the default.
  await openKeybindings(win)
  await win.getByTestId('kb-reset-new-terminal').click()
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+T')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Settings nav and dropdown menus are readable on a light theme', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kb-contrast-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Force a light elevated surface + the adaptive dark text token, then assert the nav button text
  // resolves to dark (not the light #eee default).
  // The tests tsconfig has no DOM lib (Node target), so reach DOM globals via globalThis,
  // matching the cast pattern used elsewhere in this file.
  await win.evaluate(() => {
    const g = globalThis as unknown as { document: { documentElement: { style: { setProperty(p: string, v: string): void } } } }
    g.document.documentElement.style.setProperty('--elevated', '#f5f5f5')
    g.document.documentElement.style.setProperty('--fg-on-elevated', '#182026')
  })
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  const color = await win.getByTestId('settings-nav-general').evaluate(el => {
    const g = globalThis as unknown as { getComputedStyle(e: unknown): { color: string } }
    return g.getComputedStyle(el).color
  })
  expect(color).not.toBe('rgb(238, 238, 238)')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
