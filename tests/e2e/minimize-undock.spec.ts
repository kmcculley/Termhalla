// FROZEN e2e suite — feature 0003-pane-minimize-restore (phase 4 / REQ-015).
// View-state rides the per-workspace record, so it must travel with a workspace through a multi-window
// undock without corruption or double-mounting the PTY. This minimizes one of two panes, tears the
// workspace into its own window, and asserts the minimized state is preserved there (chip present,
// pane not tiled) and the surviving pane's PTY was adopted exactly once. The pure cross-workspace
// move-clear is covered by the unit TEST-018. Runs RED until the feature ships; requires `npm run build`.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitSecondTerminal } from './split-helper'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function tileIds(win: Page): Promise<string[]> {
  return win.locator('[data-testid^="tile-"]').evaluateAll(els =>
    els.map(e => ((e as { getAttribute(n: string): string | null }).getAttribute('data-testid') || '').replace('tile-', '')))
}
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
async function tearOffFirstTab(win: Page): Promise<void> {
  const tab = win.getByTestId('workspace-tabs').locator('[data-tab-id]').first()
  const box = await tab.boundingBox()
  if (!box) throw new Error('no tab to tear off')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  await win.mouse.move(cx, cy + 500, { steps: 12 })
  await win.mouse.up()
}

// TEST-035 — REQ-015: undock preserves a workspace's minimized view-state in the new window without
// double-mounting the PTY.
test('TEST-035 REQ-015 undock preserves a minimized pane without double-mounting', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-min-undock-'))
  const app: ElectronApplication = await launch(userData)
  const main = await app.firstWindow()

  // WS1: two terminals, minimize the first.
  await main.getByTestId('add-first-terminal').click()
  await expect(main.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await splitSecondTerminal(main)
  await expect(main.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  const ids = await tileIds(main)
  await main.getByTestId(`min-${ids[0]}`).click()
  await expect(main.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 10_000 })

  // A second workspace so the main window keeps a tab after the tear-off; switch back to WS1.
  await main.getByTestId('new-workspace').click()
  await expect(main.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })
  await main.getByTestId('workspace-tabs').locator('[data-tab-id]').first().click()

  await tearOffFirstTab(main)
  // The transient OS drag-ghost window also appears in app.windows() during/just after a drag —
  // select the real floating window by its header, not "any window ≠ main".
  const floating = await findFloating(app, main)
  await expect(floating.getByTestId('floating-header')).toBeVisible({ timeout: 15_000 })

  // The minimized state travelled with the workspace: chip present, pane not tiled, sibling tiled once.
  await expect(floating.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 15_000 })
  await expect(floating.getByTestId(`tile-${ids[0]}`)).toHaveCount(0)
  await expect(floating.getByTestId(`tile-${ids[1]}`)).toBeVisible({ timeout: 15_000 })
  // PTY adopted exactly once — no second xterm for the surviving pane (no double echo).
  await expect(floating.locator(`[data-testid="terminal-${ids[1]}"]`)).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
