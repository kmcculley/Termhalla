import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(app: ElectronApplication): void {
  const pid = app.process().pid
  if (!pid) return
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* already gone */ }
}

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
}

test('saves a workspace and restores its layout on relaunch', async () => {
  test.setTimeout(90_000)

  const userData = mkdtempSync(join(tmpdir(), 'termh-e2e-'))

  // Session 1: create two tiled terminals, then save.
  let app = await launch(userData)
  let win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800) // allow async save IPC to flush to disk
  killTree(app)

  // Session 2: relaunch with same userData -> layout restored (2 terminals, no empty state).
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 20_000 })
  await expect(win.getByTestId('empty-workspace')).toHaveCount(0)
  await win.screenshot({ path: 'test-results/restore.png' })
  killTree(app)
})
