import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows the cloud status bar with AWS + Azure indicators and a detail popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-cloud-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()

  await expect(win.getByTestId('status-bar')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('cloud-aws')).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId('cloud-azure')).toBeVisible({ timeout: 20_000 })

  // AWS popover lists at least one profile row + a Refresh.
  await win.getByTestId('cloud-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()
  await expect(win.locator('[data-testid^="cloud-profile-"]')).not.toHaveCount(0)
  await expect(win.getByTestId('cloud-refresh-aws')).toBeVisible()
  await win.getByTestId('cloud-refresh-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()

  // If any profile offers Log in (installed-but-logged-out), it opens a terminal pane.
  const login = win.locator('[data-testid^="cloud-login-aws:"]').first()
  if (await login.count()) {
    await login.click()
    await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  }

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
