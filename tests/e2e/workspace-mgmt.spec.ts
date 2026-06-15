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

test('rename on create + context-menu rename persists; close works', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsmgmt-'))
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Name on create: + focuses an inline input.
  await win.getByTestId('new-workspace').click()
  const input = win.locator('[data-testid^="ws-rename-"]')
  await expect(input).toBeFocused({ timeout: 10_000 })
  await input.fill('Alpha')
  await input.press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Alpha')

  // Add a third workspace named Beta.
  await win.getByTestId('new-workspace').click()
  await win.locator('[data-testid^="ws-rename-"]').fill('Beta')
  await win.locator('[data-testid^="ws-rename-"]').press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Beta')

  // Close "Alpha" via its context menu (no panes -> no confirm dialog).
  await win.locator('[data-testid^="tab-"]', { hasText: 'Alpha' }).click({ button: 'right' })
  await expect(win.getByTestId('ws-menu')).toBeVisible()
  await win.getByTestId('ws-menu-close').click()
  await expect(win.locator('[data-testid^="tab-"]', { hasText: 'Alpha' })).toHaveCount(0)

  // Context-menu rename Beta -> Gamma, save, relaunch, still Gamma.
  await win.locator('[data-testid^="tab-"]', { hasText: 'Beta' }).click({ button: 'right' })
  await win.getByTestId('ws-menu-rename').click()
  const ri = win.locator('[data-testid^="ws-rename-"]')
  await ri.fill('Gamma'); await ri.press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Gamma')
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toContainText('Gamma', { timeout: 15_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
