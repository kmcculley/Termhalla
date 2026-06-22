import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

/** Escape a Windows path for use inside a CSS attribute selector value. */
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

test('tracks cwd, opens explorer here, and restores the directory', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-cwd-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-cwdproj-'))
  const sub = join(proj, 'subdir')
  mkdirSync(sub)
  writeFileSync(join(sub, 'marker.txt'), 'x', 'utf8')

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  // Session 1: PowerShell terminal, cd into the subdir, assert cwd tracked.
  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${sub}'`)
  await win.keyboard.press('Enter')
  // the tile's data-cwd reflects the new directory (backslashes must be CSS-escaped)
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(sub)}"]`)).toHaveCount(1, { timeout: 15_000 })

  // Open Explorer here -> an explorer pane rooted at the subdir shows marker.txt
  await win.locator('[data-testid^="cwd-"]').first().click()
  await win.locator('[data-testid^="open-explorer-here-"]').first().click()
  await expect(win.getByTestId('entry-marker.txt')).toBeVisible({ timeout: 15_000 })

  // Save + relaunch -> the terminal restored at the subdir
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  const pid1 = app.process().pid; if (pid1) killTree(pid1)

  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(sub)}"]`)).toHaveCount(1, { timeout: 20_000 })
  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})

// cmd.exe has no PROMPT_COMMAND hook; it reports cwd via OSC 9;9 emitted from the PROMPT env
// var (see shell-integration.ts). This proves cmd's $E/$P codes expand and the OSC survives
// ConPTY all the way to CwdParser — so cmd panes now persist + restore their cwd.
test('cmd tracks cwd via the PROMPT env var and restores the directory', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-cwdcmd-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-cwdcmdproj-'))
  const sub = join(proj, 'subdir')
  mkdirSync(sub)

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  // Session 1: cmd terminal, cd into the subdir, assert cwd tracked.
  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('cmd')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`cd /d "${sub}"`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(sub)}"]`)).toHaveCount(1, { timeout: 15_000 })

  // Save + relaunch -> the cmd terminal restored at the subdir
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  const pid1 = app.process().pid; if (pid1) killTree(pid1)

  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(sub)}"]`)).toHaveCount(1, { timeout: 20_000 })
  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
