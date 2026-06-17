import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

test('command palette: typing a command and Enter adds a pane', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd1-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-kbd1-proj-'))
  const f = join(proj, 'a.ts'); writeFileSync(f, '1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [f], activePath: f } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  // one editor pane to start (each editor pane renders exactly one editor-tabs strip)
  await expect(win.getByTestId('editor-tabs')).toHaveCount(1, { timeout: 10_000 })
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new editor')
  await expect(win.getByTestId('palette-item-0')).toContainText('New editor', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  // the command added a second editor pane → a second editor-tabs strip
  await expect(win.getByTestId('editor-tabs')).toHaveCount(2, { timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Ctrl+digit / Ctrl+Tab switch workspaces', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  // create a second workspace via the + button, then jump back to the first with Ctrl+1
  await win.getByTestId('new-workspace').click()
  await win.keyboard.press('Escape') // dismiss the auto-started rename
  const tabs = win.locator('[data-testid^="tab-"]')
  await expect(tabs).toHaveCount(2, { timeout: 10_000 })
  await win.keyboard.press('Control+Digit1')
  await expect(tabs.first()).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  await win.keyboard.press('Control+Tab')
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('workspace tab ArrowRight moves the active tab', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('new-workspace').click()
  await win.keyboard.press('Escape')
  const tabs = win.locator('[data-testid^="tab-"]')
  await expect(tabs).toHaveCount(2, { timeout: 10_000 })
  await tabs.first().click()              // activate + focus the first tab
  await tabs.first().focus()
  await win.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
