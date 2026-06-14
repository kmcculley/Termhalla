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

  // The bottom status bar renders, with both provider indicators (whatever their state).
  await expect(win.getByTestId('status-bar')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('cloud-aws')).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId('cloud-azure')).toBeVisible({ timeout: 20_000 })

  // Clicking an indicator opens its detail popover with a Refresh button.
  await win.getByTestId('cloud-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()
  await expect(win.getByTestId('cloud-refresh-aws')).toBeVisible()
  await win.getByTestId('cloud-refresh-aws').click()           // refresh must not crash
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()

  // If a provider offers Log in (installed-but-logged-out), it opens a terminal pane.
  const loginAws = win.getByTestId('cloud-login-aws')
  if (await loginAws.count()) {
    await loginAws.click()
    await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  }

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
