// FROZEN e2e suite — feature 0002-pane-toolbar-split-control (phase 4), REQ-014 reconciliation.
// The split is now committed via the combined compass popover: select a kind (`split-kind-*`) THEN
// activate a direction (`split-dir-*`). The old "click a kind button immediately commits" flow and
// the `split-col-${id}` button are gone. Against the current code (kind-click-commits, `split-col-`
// present) these run RED.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function firstPaneId(win: import('@playwright/test').Page): Promise<string> {
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  return tileTestId!.replace('tile-', '')
}

// TEST-021 — REQ-014/REQ-007: select Editor in the combined popover, then activate a direction →
// an editor pane splits in (Monaco), with still exactly one terminal (no extra shell).
test('TEST-021 REQ-014 combined popover: pick Editor then activate a direction splits an editor pane', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-splitmenu-'))
  const app: ElectronApplication = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const paneId = await firstPaneId(win)

  // The single split button opens ONE combined popover (no `split-col-` second button).
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await expect(win.getByTestId(`split-col-${paneId}`)).toHaveCount(0)
  await expect(win.getByTestId(`split-kind-terminal-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-kind-editor-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-kind-explorer-${paneId}`)).toBeVisible()

  // Select Editor THEN activate a direction to commit (selecting a kind alone must not commit).
  await win.getByTestId(`split-kind-editor-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1)
  await win.getByTestId(`split-dir-right-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="editor-"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-022 — REQ-014/REQ-007: Explorer kind + a downward direction opens an explorer pane rooted at
// the source cwd, committed through the combined popover.
test('TEST-022 REQ-014 combined popover: Explorer + down opens an explorer rooted at the source cwd', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-splitexp-'))
  const app: ElectronApplication = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const paneId = await firstPaneId(win)
  // Explorer needs a cwd as its root; wait until the shell has reported one.
  await expect(win.locator(`[data-testid="tile-${paneId}"]`)).not.toHaveAttribute('data-cwd', '', { timeout: 15_000 })

  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId(`split-kind-explorer-${paneId}`).click()
  await win.getByTestId(`split-dir-down-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="explorer-"]').first()).toBeVisible({ timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
