import { test, expect, _electron as electron } from '@playwright/test'
import { execSync, execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows git branch + dirty state on the pane chip, and clears it outside a repo', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-git-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-gitproj-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: proj })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 'T'])
  writeFileSync(join(proj, 'a.txt'), 'hi', 'utf8')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
  const nonRepo = mkdtempSync(join(tmpdir(), 'termh-nonrepo-'))

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  const app = await launch()
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()

  // Enter the repo -> branch chip appears.
  await win.keyboard.type(`Set-Location '${proj}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 25_000 })

  // Create an untracked file from inside the terminal -> the completing command triggers a re-probe
  // -> dirty dot appears on the chip.
  await win.keyboard.type('Set-Content extra.txt hi')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="git-chip-"]')).toContainText('●', { timeout: 25_000 })

  // Leave the repo -> chip disappears.
  await win.keyboard.type(`Set-Location '${nonRepo}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(0, { timeout: 25_000 })

  const pid = app.process().pid
  await app.close().catch(() => {})
  if (pid) killTree(pid)
})
