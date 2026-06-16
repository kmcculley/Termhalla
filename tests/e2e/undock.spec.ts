import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

/** Drag the first tab of `win` straight down off the strip → main undocks it into a new window. */
async function tearOffFirstTab(win: Page): Promise<void> {
  const tab = win.getByTestId('workspace-tabs').locator('[data-tab-id]').first()
  const box = await tab.boundingBox()
  if (!box) throw new Error('no tab to tear off')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  await win.mouse.move(cx, cy + 500, { steps: 12 })   // well past the 6px threshold and the 36px strip
  await win.mouse.up()
}

test('tear a workspace into its own window with preserved scrollback, then re-dock', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-undock-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const main = await app.firstWindow()

  // Workspace 1: open a terminal and leave a unique marker in its scrollback.
  await main.getByTestId('add-first-terminal').click()
  await expect(main.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await main.locator('.xterm-screen').click()
  await main.keyboard.type('echo tear-marker-4242')
  await main.keyboard.press('Enter')
  await expect(main.locator('.xterm-rows')).toContainText('tear-marker-4242', { timeout: 15_000 })

  // A second workspace so the main window keeps a tab after the tear-off.
  await main.getByTestId('new-workspace').click()
  await expect(main.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })
  // Switch back to WS1 so its tab is first and is what we tear off.
  await main.getByTestId('workspace-tabs').locator('[data-tab-id]').first().click()

  await tearOffFirstTab(main)

  // A second BrowserWindow appears, owning WS1, showing the preserved marker (serialize → replay).
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBeGreaterThan(1)
  const floating = app.windows().find(w => w !== main)!
  await expect(floating.getByTestId('floating-header')).toBeVisible({ timeout: 15_000 })
  await expect(floating.locator('.xterm-rows')).toContainText('tear-marker-4242', { timeout: 15_000 })

  // The PTY survived the move: typing in the floating window echoes.
  await floating.locator('.xterm-screen').click()
  await floating.keyboard.type('echo still-alive-9911')
  await floating.keyboard.press('Enter')
  await expect(floating.locator('.xterm-rows')).toContainText('still-alive-9911', { timeout: 15_000 })

  // Re-dock via the Dock button → the floating window closes, back to one window.
  await floating.getByTestId('dock-button').click()
  await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBe(1)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('restores both windows after a restart', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-undock-restart-'))

  const app1: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const main1 = await app1.firstWindow()
  await main1.getByTestId('add-first-terminal').click()
  await expect(main1.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await main1.getByTestId('new-workspace').click()
  await expect(main1.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })
  await main1.getByTestId('workspace-tabs').locator('[data-tab-id]').first().click()
  await tearOffFirstTab(main1)
  await expect.poll(() => app1.windows().length, { timeout: 20_000 }).toBe(2)
  const pid1 = app1.process().pid; await app1.close().catch(() => {}); if (pid1) killTree(pid1)

  // Relaunch with the same user-data-dir → the undocked window is restored as its own window.
  const app2: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  await expect.poll(() => app2.windows().length, { timeout: 20_000 }).toBe(2)
  const pid2 = app2.process().pid; await app2.close().catch(() => {}); if (pid2) killTree(pid2)
})
