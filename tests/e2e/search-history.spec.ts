import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('indexes output, finds it, reveals the pane, respects mute, and persists', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-search-'))
  const launch = () => electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo idx-marker-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('idx-marker-7788', { timeout: 15_000 })
  await win.waitForTimeout(1500)   // allow idle-flush + index write

  // Search finds it.
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('idx-marker-7788')
  await expect(win.getByTestId('search-result-0')).toContainText('idx-marker-7788', { timeout: 15_000 })
  // Reveal closes the modal (source pane exists).
  await win.getByTestId('search-reveal-0').click()
  await expect(win.getByTestId('search-history')).toHaveCount(0)

  // Mute the terminal, emit a second marker → not indexed.
  await win.locator('[data-testid^="history-mute-"]').first().click()
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo muted-marker-3311')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('muted-marker-3311', { timeout: 15_000 })
  await win.waitForTimeout(1500)
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('muted-marker-3311')
  await win.waitForTimeout(800)
  await expect(win.getByTestId('search-result-0')).toHaveCount(0)
  await win.keyboard.press('Escape')

  // Persist across relaunch: the first marker is still findable.
  const pid1 = app.process().pid; if (pid1) killTree(pid1)
  app = await launch(); win = await app.firstWindow()
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('idx-marker-7788')
  await expect(win.getByTestId('search-result-0')).toContainText('idx-marker-7788', { timeout: 20_000 })

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
