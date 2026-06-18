import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('broadcasts a command to all terminals in the workspace', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-bcast-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await win.locator('[data-testid^="split-terminal-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.getByTestId('broadcast-button').click()
  await win.getByTestId('broadcast-text').fill('echo bcast-7788')
  await win.getByTestId('broadcast-send').click()

  // Both terminals echoed the broadcast command.
  const rows = win.locator('.xterm-rows')
  await expect(rows.nth(0)).toContainText('bcast-7788', { timeout: 15_000 })
  await expect(rows.nth(1)).toContainText('bcast-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
