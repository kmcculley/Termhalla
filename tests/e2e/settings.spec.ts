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

test('gear opens the panel and the sidebar switches sections', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await expect(win.getByTestId('settings-general')).toBeVisible()
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('theme-scope')).toBeVisible({ timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('record-by-default toggle persists across reopen', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('settings-button').click()
  await win.getByTestId('rec-default').check()
  await win.getByTestId('settings-close').click()
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('rec-default')).toBeChecked()
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('the pane Settings menu opens Appearance scoped to that pane', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set3-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-set3-proj-'))
  const f = join(proj, 'a.ts'); writeFileSync(f, '1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [f], activePath: f } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await win.getByTestId('titlebar-p1').click({ button: 'right', position: { x: 30, y: 13 } })
  await win.getByTestId('pane-menu-settings').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('theme-scope')).toBeVisible()
  const v = await win.getByTestId('theme-scope').inputValue()
  expect(v.startsWith('pane:')).toBe(true)
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
