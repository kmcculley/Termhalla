// FROZEN e2e suite — feature 0003-pane-minimize-restore (phase 4).
// Drives the NEW minimize/restore contract: `min-${paneId}` (toolbar), `pane-menu-minimize` (context
// menu), `min-tray-${wsId}` (tray), `min-chip-${paneId}` (chip), `ws-empty-${wsId}` (all-minimized
// empty state). Against the current (unimplemented) code these fail — no minimize affordance, tray,
// or off-layout host exists. That RED state is the integrity proof; do not implement to satisfy it.
// Requires `npm run build` first (runs against out/).
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
async function rightClickTitlebar(win: Page, paneId: string): Promise<void> {
  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
}
async function launchWithTerminal(prefix: string): Promise<{ app: ElectronApplication; win: Page; paneId: string }> {
  const userData = mkdtempSync(join(tmpdir(), prefix))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const [paneId] = await tileIds(win)
  return { app, win, paneId }
}
async function launchTwoTerminals(prefix: string): Promise<{ app: ElectronApplication; win: Page; ids: string[] }> {
  const r = await launchWithTerminal(prefix)
  await splitSecondTerminal(r.win)
  await expect(r.win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 15_000 })
  return { app: r.app, win: r.win, ids: await tileIds(r.win) }
}

// TEST-024 — REQ-001/REQ-018: the three-ish entry points exist; minimizing removes the tile from the
// visible mosaic and adds a tray chip.
test('TEST-024 REQ-001 toolbar + context-menu minimize remove the tile and add a chip', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-entry-')
  await expect(win.getByTestId(`min-${paneId}`)).toHaveCount(1)        // toolbar button
  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu-minimize')).toBeVisible()    // context-menu item
  await win.keyboard.press('Escape')

  await win.getByTestId(`min-${paneId}`).click()
  await expect(win.getByTestId(`tile-${paneId}`)).toHaveCount(0)       // gone from the visible tree
  await expect(win.getByTestId(`min-chip-${paneId}`)).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-025 — REQ-002: minimizing one of two side-by-side panes reflows the survivor to fill the body
// (no blank gap, no sliver) — geometry check: survivor width ≈ full window width.
test('TEST-025 REQ-002 minimizing one pane reflows the survivor to fill the width', async () => {
  test.setTimeout(60_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-reflow-')
  await win.getByTestId(`min-${ids[0]}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1, { timeout: 10_000 })

  const box = await win.getByTestId(`tile-${ids[1]}`).boundingBox()
  const innerWidth = await win.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  expect(box!.width).toBeGreaterThan(innerWidth * 0.8)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-026 — REQ-003/REQ-018 (the proof obligation): a minimized terminal keeps running off-layout.
// A command scheduled to emit AFTER a delay fires WHILE the pane is minimized — its token is present
// on restore (output accumulated; PTY not killed/respawned), and the pre-minimize scrollback is
// intact (no remount).
test('TEST-026 REQ-003 a minimized terminal stays alive; output accumulates and survives restore', async () => {
  test.setTimeout(60_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-alive-')
  await win.locator('.xterm-screen').first().click()
  await win.keyboard.type('echo PRE-MIN-7777')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('PRE-MIN-7777', { timeout: 15_000 })

  // Schedule output that lands AFTER we minimize, then minimize before it fires.
  await win.keyboard.type('Start-Sleep -Seconds 4; echo MIN-LIVE-9999')
  await win.keyboard.press('Enter')
  await win.getByTestId(`min-${paneId}`).click()
  await expect(win.getByTestId(`tile-${paneId}`)).toHaveCount(0)
  await win.waitForTimeout(7000) // off-layout PTY produces the token while minimized

  await win.getByTestId(`min-chip-${paneId}`).click()
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.locator('.xterm-rows')).toContainText('MIN-LIVE-9999', { timeout: 10_000 }) // produced while minimized
  await expect(win.locator('.xterm-rows')).toContainText('PRE-MIN-7777')                        // scrollback intact

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-027 — REQ-004: the tray shows one chip per minimized pane, only when ≥1, chips live inside a
// per-workspace tray, and clicking a chip restores that pane and drops the chip.
test('TEST-027 REQ-004 per-workspace tray: one chip per minimized pane, restore-on-click', async () => {
  test.setTimeout(60_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-tray-')
  await expect(win.locator('[data-testid^="min-tray-"]')).toHaveCount(0) // absent when none minimized

  await win.getByTestId(`min-${ids[0]}`).click()
  await win.getByTestId(`min-${ids[1]}`).click()
  await expect(win.locator('[data-testid^="min-tray-"]')).toHaveCount(1)
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible()
  await expect(win.getByTestId(`min-chip-${ids[1]}`)).toBeVisible()

  // chips are scoped under the per-workspace tray container
  const chipInTray = await win.getByTestId(`min-chip-${ids[0]}`)
    .evaluate(el => !!(el as { closest(s: string): unknown }).closest('[data-testid^="min-tray-"]'))
  expect(chipInTray).toBe(true)

  await win.getByTestId(`min-chip-${ids[0]}`).click()
  await expect(win.getByTestId(`tile-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toHaveCount(0) // chip dropped after restore

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-028 — REQ-006: restoring re-inserts the pane split to the RIGHT — it becomes the last
// (rightmost) tile in DOM order (the layout tree's first→second order).
test('TEST-028 REQ-006 restoring places the pane to the right (new last tile)', async () => {
  test.setTimeout(60_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-place-')
  await win.getByTestId(`min-${ids[0]}`).click() // minimize the left pane
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1, { timeout: 10_000 })

  await win.getByTestId(`min-chip-${ids[0]}`).click() // restore it
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  const after = await tileIds(win)
  expect(after[after.length - 1]).toBe(ids[0]) // restored pane is the rightmost/second

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-029 — REQ-011: minimizing the sole pane is not blocked — the visible mosaic empties, the
// all-minimized empty state shows, the chip is present, and clicking it restores the pane.
test('TEST-029 REQ-011 minimizing the last pane shows the empty state; the chip restores it', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-empty-')
  await win.getByTestId(`min-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(0)
  await expect(win.locator('[data-testid^="ws-empty-"]')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`min-chip-${paneId}`)).toBeVisible()

  await win.getByTestId(`min-chip-${paneId}`).click()
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.locator('[data-testid^="ws-empty-"]')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
