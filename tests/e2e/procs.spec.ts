import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows the foreground process on the chip and in the tree popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-procs-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    // This spec asserts the foreground process chip, so it needs the fast 1s CIM poll
    // (the suite default slows it to ~off — see playwright.config.ts).
    env: { ...process.env, TERMHALLA_PROC_POLL_MS: '1000' }
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // The chip exists (idle: shows the shell name).
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toBeVisible({ timeout: 15_000 })

  // Run a long foreground command -> the chip picks up "ping" (busy-gated CIM poll ~1s).
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('ping -n 20 127.0.0.1')
  await win.keyboard.press('Enter')
  // Windows reports the image name as PING.EXE, so the foreground name renders as "PING".
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toContainText(/ping/i, { timeout: 25_000 })

  // The tree popover lists a ping row.
  await win.locator('[data-testid^="proc-chip-"]').first().click()
  await expect(win.getByTestId('proc-menu')).toBeVisible()
  await expect(win.getByTestId('proc-menu')).toContainText(/ping/i)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
