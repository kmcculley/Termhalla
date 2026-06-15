import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('detects a Claude session and clears it when the command ends', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ai-'))
  const stubDir = mkdtempSync(join(tmpdir(), 'termh-aistub-'))
  // A "claude.cmd" that prints output for a couple seconds (stays busy long enough to be
  // detected by C's busy-gated poll) then waits on a line of input, then exits.
  const stub = join(stubDir, 'claude.cmd')
  writeFileSync(stub,
    '@echo off\r\n' +
    'echo Claude Code starting\r\n' +
    'ping -n 6 127.0.0.1 >nul\r\n' +
    'echo Claude Code ready\r\n' +
    'set /p x=\r\n', 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Run the stub -> its process tree contains "claude.cmd" -> detected as a Claude session.
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`& '${stub}'`)
  await win.keyboard.press('Enter')

  // The pane chip shows the AI session, and the tab shows the ✨ indicator.
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toContainText('Claude', { timeout: 25_000 })
  await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('✨', { timeout: 5_000 })

  // Satisfy the stub's `set /p` read so it exits -> command-done -> the AI indicator clears.
  await win.keyboard.type('done')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).not.toContainText('Claude', { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
