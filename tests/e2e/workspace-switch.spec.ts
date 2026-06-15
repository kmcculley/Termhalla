import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('preserves terminal scrollback when switching workspaces away and back', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsswitch-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()

  // Workspace 1: open a terminal and leave a unique marker in its scrollback.
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo switch-marker-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('switch-marker-7788', { timeout: 15_000 })

  // Create a second workspace (this switches the active workspace away from WS1).
  await win.getByTestId('new-workspace').click()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })

  // Switch back to WS1 (the first workspace tab).
  await win.getByTestId('workspace-tabs').locator('button').first().click()

  // The terminal must still be the same live instance: its scrollback survives.
  await expect(win.locator('.xterm-rows')).toContainText('switch-marker-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
