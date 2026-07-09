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

// The visual de-garbling is validated manually; this guards that the aggressive redraw command runs
// over a focused terminal (a global shortcut bubbling past xterm) without crashing, and that the PTY
// stays alive and usable afterward — the redraw now nudges the grid and sends Ctrl+L, which a shell
// treats as "clear screen", so it deliberately does NOT preserve prior on-screen content.
test('Redraw-terminal command keeps the terminal alive and usable', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-redraw-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  // Focus the terminal before typing (and before the Ctrl+Shift+L chord below, which the comment
  // there already assumes). The pane renders before the xterm textarea takes focus, and under the
  // default TERMHALLA_E2E_WINDOW=hidden no OS focus arrives to settle it, so keystrokes are lost.
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo redraw-marker-5566')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('redraw-marker-5566', { timeout: 15_000 })

  // Default chord Ctrl+Shift+L, fired while the terminal is focused.
  await win.keyboard.press('Control+Shift+L')
  await win.waitForTimeout(400)

  // Still exactly one live terminal, and the PTY still accepts input + echoes output after the
  // resize nudge + Ctrl+L. Ctrl+C first to discard any partial line the form feed left at the prompt.
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1)
  await win.keyboard.press('Control+C')
  await win.keyboard.type('echo redraw-after-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('redraw-after-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
