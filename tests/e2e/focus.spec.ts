import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

/** The class of xterm's hidden input. When it's the active element, the terminal has keyboard
 *  focus and typing reaches the PTY without a click. (No DOM lib in the test tsconfig — cast.) */
const activeClass = (win: Page): Promise<string> =>
  win.evaluate(() => {
    const g = globalThis as unknown as { document: { activeElement: { className?: string } | null } }
    return g.document.activeElement?.className ?? ''
  })

test('a newly created terminal is focused so you can type without clicking', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-focus1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  // No click on the terminal: focus must move to it on creation.
  await expect.poll(() => activeClass(win), { timeout: 10_000 }).toContain('xterm-helper-textarea')
  await win.keyboard.type('echo focus-on-create-4242')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('focus-on-create-4242', { timeout: 15_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('closing a dialog restores focus to the terminal', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-focus2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => activeClass(win), { timeout: 10_000 }).toContain('xterm-helper-textarea')

  // Open Settings (a Modal). It takes focus away from the terminal.
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await expect.poll(() => activeClass(win), { timeout: 5_000 }).not.toContain('xterm-helper-textarea')

  // Closing it must hand focus back to the terminal — this is the "can't type while a toast is up" bug.
  await win.getByTestId('settings-close').click()
  await expect(win.getByTestId('settings-panel')).toHaveCount(0)
  await expect.poll(() => activeClass(win), { timeout: 10_000 }).toContain('xterm-helper-textarea')
  await win.keyboard.type('echo after-dialog-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('after-dialog-7788', { timeout: 15_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('switching back to a workspace focuses its terminal', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-focus3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()

  // WS1 with a terminal.
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // A second workspace switches the active tab away from WS1.
  await win.getByTestId('new-workspace').click()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })

  // Switch back to WS1: its terminal must regain focus without a click.
  await win.getByTestId('workspace-tabs').locator('button').first().click()
  await expect.poll(() => activeClass(win), { timeout: 10_000 }).toContain('xterm-helper-textarea')
  await win.keyboard.type('echo back-on-ws1-9911')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('back-on-ws1-9911', { timeout: 15_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
