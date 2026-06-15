import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('runs a delayed scheduled command in the terminal', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-sched-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  await win.locator('[data-testid^="schedule-chip-"]').first().click()
  await expect(win.getByTestId('schedule-dialog')).toBeVisible()
  await win.getByTestId('schedule-text').fill('echo sched-4242')
  await win.getByTestId('schedule-delay-value').fill('1')
  await win.getByTestId('schedule-add').click()

  // Close the dialog overlay if it's still open so xterm-rows is interactable
  const dialog = win.getByTestId('schedule-dialog')
  if (await dialog.isVisible()) {
    await dialog.click({ position: { x: 5, y: 5 } })
  }

  await expect(win.locator('.xterm-rows')).toContainText('sched-4242', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
