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

/** Open the app fresh, add the first terminal, wait for the tile to appear, and return the pane id. */
async function launchWithTerminal(): Promise<{ app: ElectronApplication; paneId: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'termh-pane-act-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  const paneId = tileTestId!.replace('tile-', '')
  return { app, paneId }
}

/** Right-click the pane title bar to open its context menu. The toolbar layout is
 *  [title text (flex:1)] [buttons], so right-clicking near the left lands on the title text, away
 *  from the toolbar buttons, and fires the onContextMenu handler. */
async function rightClickTitlebar(win: import('@playwright/test').Page, paneId: string): Promise<void> {
  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
}

test('right-click title bar shows the four menu items', async () => {
  test.setTimeout(40_000)
  const { app, paneId } = await launchWithTerminal()
  const win = await app.firstWindow()

  await rightClickTitlebar(win, paneId)
  await expect(win.getByTestId('pane-menu')).toBeVisible()
  await expect(win.getByTestId('pane-menu-rename')).toBeVisible()
  await expect(win.getByTestId('pane-menu-move')).toBeVisible()
  await expect(win.getByTestId('pane-menu-settings')).toBeVisible()
  await expect(win.getByTestId('pane-menu-close')).toBeVisible()

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('rename updates the pane title', async () => {
  test.setTimeout(40_000)
  const { app, paneId } = await launchWithTerminal()
  const win = await app.firstWindow()

  await rightClickTitlebar(win, paneId)
  await win.getByTestId('pane-menu-rename').click()
  const input = win.getByTestId(`pane-rename-${paneId}`)
  await input.fill('My Shell')
  await input.press('Enter')
  await expect(win.getByTestId(`titlebar-${paneId}`)).toContainText('My Shell')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('env/settings/style buttons are gone; Settings menu item opens the panel', async () => {
  test.setTimeout(40_000)
  const { app, paneId } = await launchWithTerminal()
  const win = await app.firstWindow()

  // These buttons must not exist on a terminal pane toolbar
  await expect(win.getByTestId(`env-chip-${paneId}`)).toHaveCount(0)
  await expect(win.getByTestId(`gear-${paneId}`)).toHaveCount(0)
  await expect(win.getByTestId(`theme-chip-${paneId}`)).toHaveCount(0)

  // Settings is accessible via the right-click menu
  await rightClickTitlebar(win, paneId)
  await win.getByTestId('pane-menu-settings').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('move to a new workspace keeps the pane alive', async () => {
  test.setTimeout(60_000)
  const { app, paneId } = await launchWithTerminal()
  const win = await app.firstWindow()

  // Confirm the tile is present before moving
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible()

  await rightClickTitlebar(win, paneId)
  await win.getByTestId('pane-menu-move').click()
  await win.getByTestId('move-new-workspace').click()

  // Same pane id must still be visible — now in the newly-active workspace
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-023 — REQ-014: updated to the combined-popover contract — select the Terminal kind THEN
// activate a direction to commit the sibling split (no kind-click-immediately-commits, no
// `split-col-`). The portal guarantee for the popover is asserted by split-compass.spec.ts TEST-007.
/** A maximized pane must not bleed through other workspaces. The maximize CSS punches
 *  `visibility: visible` through `.ws-max`'s sibling-hiding — but `visibility: hidden` on the
 *  INACTIVE workspace host is overridable by that same descendant rule, so without scoping the
 *  punch-through to the active host, the maximized tile keeps painting under a transparent (e.g.
 *  brand-new empty) workspace. */
test('a maximized pane stays hidden when another (empty) workspace is active', async () => {
  test.setTimeout(40_000)
  const { app, paneId: a } = await launchWithTerminal()
  const win = await app.firstWindow()

  await win.getByTestId(`max-${a}`).click()
  await expect(win.getByTestId(`tile-${a}`)).toBeVisible()

  // New empty workspace (dismiss the auto-opened rename). Its body is transparent — exactly where
  // a bleed-through would show.
  await win.getByTestId('new-workspace').click()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`tile-${a}`)).not.toBeVisible()

  // Switching back, the maximized pane is visible again.
  await win.locator('[data-tab-id]').first().click()
  await expect(win.getByTestId(`tile-${a}`)).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-023 REQ-014 maximize hides siblings; restore brings them back', async () => {
  test.setTimeout(40_000)
  const { app, paneId: a } = await launchWithTerminal()
  const win = await app.firstWindow()

  // Split to create a sibling: open the combined popover, pick Terminal, then activate a direction.
  await win.getByTestId(`split-${a}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId(`split-kind-terminal-${a}`).click()
  await win.getByTestId(`split-dir-right-${a}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  const siblingTile = win.locator('[data-testid^="tile-"]').nth(1)
  const siblingTestId = await siblingTile.getAttribute('data-testid')
  const b = siblingTestId!.replace('tile-', '')

  // Maximize pane A — sibling B should become invisible (visibility:hidden)
  await win.getByTestId(`max-${a}`).click()
  await expect(win.getByTestId(`tile-${a}`)).toBeVisible()
  await expect(win.getByTestId(`tile-${b}`)).not.toBeVisible()

  // Restore — sibling B should be visible again
  await win.getByTestId(`max-${a}`).click()
  await expect(win.getByTestId(`tile-${b}`)).toBeVisible({ timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
