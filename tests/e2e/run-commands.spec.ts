import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitSecondTerminal } from './split-helper'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('saves, runs, and persists pane + workspace run commands', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-run-'))
  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Add a PANE command and run it.
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await win.getByTestId('run-cmd-label').fill('Echo')
  await win.getByTestId('run-cmd-command').fill('echo run-4242')
  await win.getByTestId('run-cmd-scope').selectOption('pane')
  await win.getByTestId('run-cmd-add').click()
  // Run it (running closes the dialog).
  await win.locator('[data-testid^="run-cmd-"]').first().click()
  await expect(win.locator('.xterm-rows')).toContainText('run-4242', { timeout: 15_000 })

  // Add a WORKSPACE command.
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await win.getByTestId('run-cmd-label').fill('Hi')
  await win.getByTestId('run-cmd-command').fill('echo workspace-cmd')
  await win.getByTestId('run-cmd-scope').selectOption('workspace')
  await win.getByTestId('run-cmd-add').click()
  // Close the dialog (click backdrop).
  await win.getByTestId('run-commands-dialog').click({ position: { x: 5, y: 5 } })

  // Split a second terminal; its run menu shows the workspace command.
  await splitSecondTerminal(win)
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.locator('[data-testid^="run-chip-"]').nth(1).click()
  await expect(win.getByTestId('run-commands-dialog')).toContainText('workspace-cmd')
  await win.getByTestId('run-commands-dialog').click({ position: { x: 5, y: 5 } })

  // Save + relaunch -> both commands persist.
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  const pid1 = app.process().pid; if (pid1) killTree(pid1)

  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="run-chip-"]').first()).toBeVisible({ timeout: 20_000 })
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await expect(win.getByTestId('run-commands-dialog')).toContainText('run-4242')
  await expect(win.getByTestId('run-commands-dialog')).toContainText('workspace-cmd')

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
