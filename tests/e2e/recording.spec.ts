import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

/** Concatenated contents of every .cast file in the app's recordings dir. */
function castContents(userData: string): string {
  const dir = join(userData, 'recordings')
  if (!existsSync(dir)) return ''
  return readdirSync(dir).filter(f => f.endsWith('.cast')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
}

/** Right-click the title text (left side of the bar, away from the toolbar buttons). */
async function rightClickTitlebar(win: import('@playwright/test').Page, paneId: string): Promise<void> {
  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
}

test('records a terminal session to a .cast file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-rec-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  const paneId = tileTestId!.replace('tile-', '')

  // Record moved off the toolbar onto the title-bar context menu (feature 0002). Start via the menu.
  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu-record')).toContainText('Start recording')
  await win.getByTestId('pane-menu-record').click() // start, closes the menu
  await expect(win.getByTestId('pane-menu')).toHaveCount(0)

  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo rec-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('rec-7788', { timeout: 15_000 })
  await win.waitForTimeout(600)

  // Stop via the menu (now labelled "Stop recording") -> finalize the .cast.
  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu-record')).toContainText('Stop recording')
  await win.getByTestId('pane-menu-record').click()

  await expect.poll(() => castContents(userData), { timeout: 10_000 }).toContain('rec-7788')
  // It's a valid asciinema v2 cast (header line parses with version 2).
  const dir = join(userData, 'recordings')
  const file = readdirSync(dir).find(f => f.endsWith('.cast'))!
  const header = JSON.parse(readFileSync(join(dir, file), 'utf8').split('\n')[0]) as { version: number }
  expect(header.version).toBe(2)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
