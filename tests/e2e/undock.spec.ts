import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

/** The OS-level tear-off ghost: a DOM ghost is clipped at the window edge, so once the drag cursor
 *  leaves every app window, main shows a frameless mini window that follows the screen cursor.
 *  Playwright can't move the OS cursor outside the Electron window, so this drives the same
 *  renderer→main channel the drag uses (`winDragGhost`) directly and asserts the window lifecycle;
 *  the show/hide decision itself is unit-tested (ghostVisibleAt). */
test('tear-off ghost window appears outside the app and dies on drag end', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ghostwin-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const main = await app.firstWindow()
  await expect(main.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

  // A drag position far outside every window → the ghost window is created and shown.
  await main.evaluate(() => (window as unknown as { termhalla: { winDragGhost(a: unknown): void } })
    .termhalla.winDragGhost({ x: 30_000, y: 30_000, name: 'Ghost WS' }))
  await expect.poll(windowCount, { timeout: 10_000 }).toBe(2)

  // Back inside the app window → hidden (not visible), but drag still ongoing.
  const inside = await main.evaluate(() => {
    const g = globalThis as unknown as { screenX: number; screenY: number }
    return { x: g.screenX + 200, y: g.screenY + 200 }
  })
  await main.evaluate((p) => (window as unknown as { termhalla: { winDragGhost(a: unknown): void } })
    .termhalla.winDragGhost({ ...p, name: 'Ghost WS' }), inside)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter(w => w.isVisible()).length), { timeout: 10_000 }).toBe(1)

  // Drag end (null) → the ghost window is destroyed.
  await main.evaluate(() => (window as unknown as { termhalla: { winDragGhost(a: unknown): void } })
    .termhalla.winDragGhost(null))
  await expect.poll(windowCount, { timeout: 10_000 }).toBe(1)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid!)
})

/** Find the torn-off floating window. The transient OS drag-ghost window also appears in
 *  app.windows() during/just after a drag, so "any window ≠ main" can grab the wrong (or an
 *  already-closed) page — select by the floating header instead. */
async function findFloating(app: ElectronApplication, main: Page): Promise<Page> {
  for (let tries = 0; tries < 100; tries++) {
    for (const w of app.windows()) {
      if (w === main || w.isClosed()) continue
      const n = await w.getByTestId('floating-header').count().catch(() => 0)
      if (n > 0) return w
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('no floating window with a floating-header appeared')
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
  const floating = await findFloating(app, main)
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
  // Wait for the REAL floating window (not the transient drag ghost, which would satisfy a bare
  // window count and let the app be killed before the new arrangement is persisted).
  const floating1 = await findFloating(app1, main1)
  await expect(floating1.getByTestId('floating-header')).toBeVisible({ timeout: 15_000 })
  const pid1 = app1.process().pid; await app1.close().catch(() => {}); if (pid1) killTree(pid1)

  // Relaunch with the same user-data-dir → the undocked window is restored as its own window.
  const app2: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  await expect.poll(() => app2.windows().length, { timeout: 20_000 }).toBe(2)
  const pid2 = app2.process().pid; await app2.close().catch(() => {}); if (pid2) killTree(pid2)
})
