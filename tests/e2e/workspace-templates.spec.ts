import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('saves a 2-terminal workspace as a template and creates a new workspace from it', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tpl-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  // Open templates menu and save current layout as a template.
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('TwoTerms')
  await win.getByTestId('tpl-save').click()

  // The menu stays open after saving — click the newly-created template entry directly.
  await win.locator('[data-testid^="tpl-"]', { hasText: 'TwoTerms' }).click()

  // The active (new) workspace has two terminal tiles.
  const activeHost = win.locator('[data-testid="workspace-host"][data-active="true"]')
  await expect(activeHost.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
