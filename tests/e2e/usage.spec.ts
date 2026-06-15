import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }
function encodeProjectDir(cwd: string): string { return cwd.replace(/[^a-zA-Z0-9]/g, '-') }

test('shows Claude context % on the chip and token breakdown in the popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-usage-'))
  const claudeHome = join(mkdtempSync(join(tmpdir(), 'termh-claudehome-')), '.claude')
  mkdirSync(join(claudeHome, 'projects'), { recursive: true })
  const projDir = mkdtempSync(join(tmpdir(), 'termh-usageproj-'))

  const stubDir = mkdtempSync(join(tmpdir(), 'termh-usagestub-'))
  const stub = join(stubDir, 'claude.cmd')
  writeFileSync(stub, '@echo off\r\necho claude\r\nping -n 8 127.0.0.1 >nul\r\nset /p x=\r\n', 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, TERMHALLA_CLAUDE_HOME: claudeHome }
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${projDir}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(projDir)}"]`)).toHaveCount(1, { timeout: 15_000 })

  // Seed the transcript under the dir the app derives from the reported cwd (encode exactly).
  const reported = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-cwd')
  const sessionDir = join(claudeHome, 'projects', encodeProjectDir(reported!))
  mkdirSync(sessionDir, { recursive: true })
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 } } })
  ].join('\n')
  writeFileSync(join(sessionDir, 'sess.jsonl'), transcript, 'utf8')

  await win.keyboard.type(`& '${stub}'`)
  await win.keyboard.press('Enter')

  // Chip shows the context % (last turn: 120 + 150000 = 150120 / 200000 = 75%).
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toContainText('75%', { timeout: 25_000 })

  // Popover shows the token breakdown (input total 220).
  await win.locator('[data-testid^="proc-chip-"]').first().click()
  await expect(win.locator('[data-testid^="usage-"]').first()).toBeVisible()
  await expect(win.locator('[data-testid^="usage-"]').first()).toContainText('220')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
