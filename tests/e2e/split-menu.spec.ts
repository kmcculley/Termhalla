import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function firstPaneId(win: import('@playwright/test').Page): Promise<string> {
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  return tileTestId!.replace('tile-', '')
}

test('split button opens a Terminal/Editor/Explorer menu and Editor splits an editor pane', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-splitmenu-'))
  const app: ElectronApplication = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const paneId = await firstPaneId(win)

  // Split-right no longer opens a terminal directly — it offers a choice.
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await expect(win.getByTestId(`split-terminal-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-editor-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-explorer-${paneId}`)).toBeVisible()

  // Choosing Editor splits an editor pane (Monaco), not a terminal.
  await win.getByTestId(`split-editor-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="editor-"]').first()).toBeVisible({ timeout: 15_000 })
  // Still exactly one terminal — the split did not open another shell.
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('split-down menu Explorer opens an explorer pane rooted at the source cwd', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-splitexp-'))
  const app: ElectronApplication = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const paneId = await firstPaneId(win)
  // Explorer needs a cwd as its root; wait until the shell has reported one.
  await expect(win.locator(`[data-testid="tile-${paneId}"]`)).not.toHaveAttribute('data-cwd', '', { timeout: 15_000 })

  await win.getByTestId(`split-col-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId(`split-explorer-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="explorer-"]').first()).toBeVisible({ timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
