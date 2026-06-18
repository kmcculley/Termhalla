import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

// The visual de-garbling is validated manually; this guards that the redraw command runs over a
// focused terminal (a global shortcut bubbling past xterm) without crashing or losing content.
test('Redraw-terminal command keeps the terminal alive and its content', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-redraw-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.keyboard.type('echo redraw-marker-5566')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('redraw-marker-5566', { timeout: 15_000 })

  // Default chord Ctrl+Shift+L, fired while the terminal is focused.
  await win.keyboard.press('Control+Shift+L')
  await win.waitForTimeout(400)

  // Still exactly one live terminal, content preserved (the redraw repaints, it doesn't clear).
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1)
  await expect(win.locator('.xterm-rows')).toContainText('redraw-marker-5566')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
