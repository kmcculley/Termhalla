import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

test('broadcast: Shift+Enter sends, and quick-key buttons are present', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.getByTestId('broadcast-button').click()
  await expect(win.getByTestId('broadcast-key-ctrl-c')).toBeEnabled()
  await win.getByTestId('broadcast-text').fill('echo pol-shift-7788')
  await win.getByTestId('broadcast-text').press('Shift+Enter')

  const rows = win.locator('.xterm-rows')
  await expect(rows.nth(0)).toContainText('pol-shift-7788', { timeout: 15_000 })
  await expect(rows.nth(1)).toContainText('pol-shift-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('schedule dialog spans the full window (not clipped by an adjacent terminal)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.locator('[data-testid^="schedule-chip-"]').first().click()
  const dialog = win.getByTestId('schedule-dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  const innerWidth = await win.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  // Portalled to <body>, the fixed inset:0 overlay covers the whole viewport (≈ full width),
  // rather than being confined to one mosaic tile (~half width).
  expect(box!.width).toBeGreaterThan(innerWidth * 0.9)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('rename: the existing workspace name is selected on focus', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.locator('[data-testid^="tab-"]').first().click({ button: 'right' })
  await win.getByTestId('ws-menu-rename').click()
  const input = win.locator('[data-testid^="ws-rename-"]')
  await expect(input).toBeFocused()
  const fullySelected = await input.evaluate(el => {
    const i = el as unknown as { value: string; selectionStart: number | null; selectionEnd: number | null }
    return i.value.length > 0 && i.selectionStart === 0 && i.selectionEnd === i.value.length
  })
  expect(fullySelected).toBe(true)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
