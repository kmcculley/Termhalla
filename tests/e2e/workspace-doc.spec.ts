import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * File menu — save/open/close/reopen a workspace as a document.
 * Launches the real app against out/ (requires `npm run build` first). Native dialogs are hermetic
 * via TERMHALLA_WSDOC_SAVE_PATH / TERMHALLA_WSDOC_OPEN_PATH (the register-fs TERMHALLA_SAVE_PATH
 * precedent); the native File menu items are driven by clicking them in the main process.
 */

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, ...env } as Record<string, string>
  })
}

/** Click a File-menu item by its id in the main process (the handler sends menu:file-* to the window). */
function clickFileItem(app: ElectronApplication, id: string) {
  return app.evaluate(({ Menu }, itemId) => {
    const file = Menu.getApplicationMenu()?.items.find(i => i.label === 'File')
    file?.submenu?.items.find(s => s.id === itemId)?.click()
  }, id)
}

test('File menu exists with the document actions, before Edit', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsdoc-menu-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  const shape = await app.evaluate(({ Menu }) => {
    const items = Menu.getApplicationMenu()?.items ?? []
    const file = items.find(i => i.label === 'File')
    return {
      labels: items.map(i => i.label),
      fileItems: file?.submenu?.items.filter(s => s.label).map(s => s.label) ?? []
    }
  })
  expect(shape.labels.indexOf('File')).toBe(0)
  expect(shape.labels.indexOf('File')).toBeLessThan(shape.labels.indexOf('Edit'))
  expect(shape.fileItems).toEqual([
    'New Workspace', 'Open Workspace…', 'Reopen Closed Workspace…',
    'Save Workspace', 'Save Workspace As…', 'Exit'
  ])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('File ▸ New Workspace adds a tab', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsdoc-new-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  const before = await win.locator('[data-testid^="tab-"]').count()
  await clickFileItem(app, 'file-new')
  await expect(win.locator('[data-testid^="tab-"]')).toHaveCount(before + 1, { timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Save As writes a .thws document, and Open reads it back into a new workspace', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsdoc-saveopen-'))
  const docPath = join(mkdtempSync(join(tmpdir(), 'termh-wsdoc-file-')), 'saved.thws')
  const app = await launch(userData, { TERMHALLA_WSDOC_SAVE_PATH: docPath, TERMHALLA_WSDOC_OPEN_PATH: docPath })
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Give the active workspace a terminal (so the saved document has a real pane with a cwd).
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Save As → writes the .thws document.
  await clickFileItem(app, 'file-save-as')
  await expect.poll(() => existsSync(docPath), { timeout: 10_000 }).toBe(true)
  const doc = JSON.parse(readFileSync(docPath, 'utf8'))
  expect(doc.schemaVersion).toBeGreaterThanOrEqual(9)
  expect(Object.keys(doc.workspace.panes).length).toBeGreaterThanOrEqual(1)

  // Open → the document loads as an additional workspace with its pane restored.
  const tabsBefore = await win.locator('[data-testid^="tab-"]').count()
  const termsBefore = await win.locator('[data-testid^="terminal-"]').count()
  await clickFileItem(app, 'file-open')
  await expect(win.locator('[data-testid^="tab-"]')).toHaveCount(tabsBefore + 1, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(termsBefore + 1, { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('a closed workspace can be reopened from the Reopen dialog', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsdoc-reopen-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Create a named workspace "Beta".
  await win.getByTestId('new-workspace').click()
  const rename = win.locator('[data-testid^="ws-rename-"]')
  await expect(rename).toBeFocused({ timeout: 10_000 })
  await rename.fill('Beta'); await rename.press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Beta')

  // Persist everything to disk, then close Beta (empty → no confirm). Its record stays on disk.
  await clickFileItem(app, 'file-save')
  await win.waitForTimeout(600)
  await win.locator('[data-testid^="tab-"]', { hasText: 'Beta' }).click({ button: 'right' })
  await expect(win.getByTestId('ws-menu')).toBeVisible()
  await win.getByTestId('ws-menu-close').click()
  await expect(win.locator('[data-testid^="tab-"]', { hasText: 'Beta' })).toHaveCount(0)

  // Reopen it via the File menu → dialog → the Beta row.
  await clickFileItem(app, 'file-reopen')
  await expect(win.getByTestId('reopen-ws')).toBeVisible({ timeout: 5_000 })
  await win.locator('[data-testid^="reopen-ws-open-"]', { hasText: 'Beta' }).click()
  await expect(win.getByTestId('reopen-ws')).toHaveCount(0)
  await expect(win.locator('[data-testid^="tab-"]', { hasText: 'Beta' })).toHaveCount(1, { timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
