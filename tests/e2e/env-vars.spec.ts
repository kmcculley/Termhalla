import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('sets a global env var and a new terminal sees it', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-env-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()

  // Open the env manager and create a fresh encrypted vault (unlocked in-session).
  await win.getByTestId('env-button').click()
  await expect(win.getByTestId('env-manager')).toBeVisible()
  await win.getByTestId('env-passphrase').fill('pw')
  await win.getByTestId('env-create').click()

  // Add a global var; the row appearing confirms it persisted into the unlocked vault.
  await win.getByTestId('env-name').fill('FOO')
  await win.getByTestId('env-value').fill('bar7788')
  await win.getByTestId('env-add').click()
  await expect(win.getByTestId('env-row-FOO')).toBeVisible({ timeout: 10_000 })

  // Close the manager (use the explicit Close button, not the overlay).
  await win.getByRole('button', { name: 'Close' }).click()
  await expect(win.getByTestId('env-manager')).toBeHidden()

  // Spawn a PowerShell terminal — global vars are injected at spawn time.
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo $env:FOO')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('bar7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
