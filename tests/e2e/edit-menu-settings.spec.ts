import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Feature 0001 — REQ-001 / REQ-002 / REQ-004 / REQ-005 / REQ-008 (e2e).
 * Launches the real app against out/ (requires `npm run build` first).
 *
 * RED until the menu (TASK-003/004), the gear removal (TASK-005), the gate (TASK-008) and the
 * checkbox (TASK-009) land.
 */
function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

/** Read the application-menu shape from the main process. */
function readMenu(app: Awaited<ReturnType<typeof launch>>) {
  return app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const items = menu?.items ?? []
    return {
      labels: items.map(i => i.label),
      edit: (() => {
        const e = items.find(i => i.label === 'Edit')
        if (!e || !e.submenu) return null
        return e.submenu.items.map(s => ({ label: s.label, accelerator: s.accelerator }))
      })(),
    }
  })
}

test('TEST-013: native menu has Edit before View/Help with a single Settings… item', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-editmenu1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  const { labels, edit } = await readMenu(app)
  const editIdx = labels.indexOf('Edit')
  expect(editIdx).toBeGreaterThanOrEqual(0)
  expect(editIdx).toBeLessThan(labels.indexOf('View'))
  expect(editIdx).toBeLessThan(labels.indexOf('Help'))
  expect(edit).not.toBeNull()
  expect(edit).toHaveLength(1)
  expect(edit![0].label).toBe('Settings…')
  expect(edit![0].accelerator).toBe('CmdOrCtrl+,')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-014: Edit ▸ Settings… opens the Settings modal at General', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-editmenu2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.bringToFront()

  // Trigger the menu item's click in the main process (the handler sends menu:open-settings to
  // the focused window). If focus is unavailable headless, see the menu-template unit test
  // (tests/main/menu.test.ts) which asserts the click->send wiring directly.
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const edit = menu?.items.find(i => i.label === 'Edit')
    const item = edit?.submenu?.items.find(i => i.label === 'Settings…')
    item?.click()
  })

  await expect(win.getByTestId('settings-general')).toBeVisible({ timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-015 / TEST-016: gear settings-button is gone; Ctrl+, still opens Settings', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-editmenu3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // REQ-004: the gear (⚙) entry point is removed from the workspace-tabs bar.
  await expect(win.getByTestId('settings-button')).toHaveCount(0)

  // REQ-004: the Ctrl+, keybinding entry point is preserved.
  await win.keyboard.press('Control+Comma')
  await expect(win.getByTestId('settings-general')).toBeVisible({ timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-017: General settings shows toasts-enabled checkbox, unchecked by default', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-editmenu4-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.keyboard.press('Control+Comma')
  await expect(win.getByTestId('settings-general')).toBeVisible({ timeout: 5_000 })
  const cb = win.getByTestId('toasts-enabled')
  await expect(cb).toBeVisible()
  await expect(cb).not.toBeChecked() // REQ-005/REQ-008: default OFF

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-018: toasts suppressed by default; enabling the toggle surfaces a toast', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-editmenu5-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Default OFF: saving a template fires pushToast, but no toast should appear (REQ-005).
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('Tpl A')
  await win.getByTestId('tpl-save').click()
  await expect(win.getByTestId('toast')).toHaveCount(0)

  // Enable toasts via the General settings checkbox (REQ-008).
  await win.keyboard.press('Control+Comma')
  await expect(win.getByTestId('settings-general')).toBeVisible({ timeout: 5_000 })
  await win.getByTestId('toasts-enabled').check()
  await win.getByTestId('settings-close').click()

  // Now the same toast-producing action surfaces a toast.
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('Tpl B')
  await win.getByTestId('tpl-save').click()
  await expect(win.getByTestId('toast')).toContainText('Template saved', { timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
