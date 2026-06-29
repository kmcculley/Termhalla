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

test('status bar shows a shortcut tip that reflects the current binding', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tip-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // First tip in rotation is the new-pane tip at its default chord.
  const tip = win.getByTestId('statusbar-tip')
  await expect(tip).toContainText('Press')
  await expect(tip).toContainText('Ctrl+Shift+T')
  await expect(tip).toContainText('open a new pane')

  // Rebind new-terminal and confirm the tip text updates live (no rotation wait needed).
  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-keybindings').click()
  await win.getByTestId('kb-change-new-terminal').click()
  // Wait until capture is armed (cell shows "Press shortcut…") before pressing, so the chord isn't
  // dropped by the click→press race on slower machines.
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Press shortcut…')
  // Ctrl+Shift+Y (not Ctrl+Shift+N — Chromium reserves that for incognito and swallows the keydown).
  await win.keyboard.press('Control+Shift+Y')
  await win.getByTestId('settings-close').click()
  await expect(tip).toContainText('Ctrl+Shift+Y')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
