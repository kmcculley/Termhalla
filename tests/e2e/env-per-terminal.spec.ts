import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('a per-terminal var is written under the pane and persists', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-env-term-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  // Wait for the app shell to finish booting before driving keyboard shortcuts — the renderer's
  // Ctrl+, handler isn't live until the workspace chrome mounts (the canonical readiness gate used
  // by settings.spec.ts / edit-menu-settings.spec.ts). Without it the keypress races app boot and
  // is dropped, so Settings never opens.
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Create a fresh encrypted vault (unlocked in-session) via the global settings.
  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-environment').click()
  await expect(win.getByTestId('settings-environment')).toBeVisible()
  await win.getByTestId('env-passphrase').fill('pw')
  await win.getByTestId('env-create').click()

  // Close the settings panel.
  await win.getByTestId('settings-close').click()
  await expect(win.getByTestId('settings-panel')).toBeHidden()

  // Spawn a PowerShell terminal.
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Open the pane-scoped env settings via the pane's right-click Settings menu.
  await win.locator('[data-testid^="titlebar-"]').first().click({ button: 'right', position: { x: 30, y: 13 } })
  await win.getByTestId('pane-menu-settings').click()
  await win.getByTestId('settings-nav-environment').click()
  await expect(win.getByTestId('settings-environment')).toBeVisible()
  await expect(win.getByTestId('env-term-section')).toBeVisible({ timeout: 10_000 })

  // Add a per-terminal var; the row appearing confirms it persisted under the pane's envId.
  await win.getByTestId('env-term-name').fill('BAR')
  await win.getByTestId('env-term-value').fill('baz9911')
  await win.getByTestId('env-term-add').click()
  await expect(win.getByTestId('env-term-row-BAR')).toBeVisible({ timeout: 10_000 })

  // Close the panel.
  await win.getByTestId('settings-close').click()
  await expect(win.getByTestId('settings-panel')).toBeHidden()

  // Reopen the pane's env — the var must still be there (re-read from the vault via env:get).
  await win.locator('[data-testid^="titlebar-"]').first().click({ button: 'right', position: { x: 30, y: 13 } })
  await win.getByTestId('pane-menu-settings').click()
  await win.getByTestId('settings-nav-environment').click()
  await expect(win.getByTestId('settings-environment')).toBeVisible()
  await expect(win.getByTestId('env-term-row-BAR')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
