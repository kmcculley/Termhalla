import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync, execFileSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitSecondTerminal } from './split-helper'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('per-project notepad: take a note, persist across relaunch, scope by project', async () => {
  test.setTimeout(75_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-notes-'))
  const projA = mkdtempSync(join(tmpdir(), 'termh-notesA-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: projA })
  const projB = mkdtempSync(join(tmpdir(), 'termh-notesB-'))

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${projA}'`)
  await win.keyboard.press('Enter')
  // wait until the git/cwd resolves for this pane (chip shows the branch)
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 20_000 })

  // Open notes, type a note for project A.
  await win.getByTestId('notes-toggle').click()
  await expect(win.getByTestId('notes-panel')).toBeVisible()
  await win.getByTestId('notes-textarea').fill('PROJECT-A-NOTE')
  await win.waitForTimeout(1200)  // debounce flush

  // Relaunch -> note persists.
  const pid1 = app.process().pid; if (pid1) killTree(pid1)
  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 20_000 })
  // Click the terminal to set focusedPaneId so NotesPanel can resolve the project key.
  await win.locator('.xterm-screen').click()
  await win.getByTestId('notes-toggle').click()
  await expect(win.getByTestId('notes-textarea')).toHaveValue('PROJECT-A-NOTE', { timeout: 15_000 })

  // Split a second terminal, cd into project B, focus it -> notes are empty (different project).
  await splitSecondTerminal(win)
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.locator('.xterm-screen').nth(1).click()
  await win.keyboard.type(`Set-Location '${projB}'`)
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('notes-textarea')).toHaveValue('', { timeout: 20_000 })

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
