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

// The tip rotates through TIP_COMMANDS (6 entries) every 7s, so a full cycle is 42s. Any assertion
// that waits for one PARTICULAR tip must therefore out-wait a full cycle — an `expect().toContainText`
// with the default 5s timeout only passes if that tip happens to be showing. This test opened
// Settings, rebound a chord, and closed it (>7s under the default TERMHALLA_E2E_WINDOW=hidden), by
// which point the rotation had moved on to the palette tip. Poll for the new-pane tip to come around.
const TIP_CYCLE_MS = 6 * 7_000
/** Wait for the new-pane tip (the only one that names a new-terminal chord) and return its text. */
const newPaneTip = async (tip: import('@playwright/test').Locator): Promise<string> => {
  await expect.poll(async () => (await tip.textContent()) ?? '', { timeout: TIP_CYCLE_MS + 10_000 })
    .toContain('open a new pane')
  return (await tip.textContent()) ?? ''
}

test('status bar shows a shortcut tip that reflects the current binding', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tip-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // The new-pane tip shows its default chord.
  const tip = win.getByTestId('statusbar-tip')
  const initial = await newPaneTip(tip)
  expect(initial).toContain('Press')
  expect(initial).toContain('Ctrl+Shift+T')

  // Rebind new-terminal and confirm the tip text updates live (no rotation wait needed).
  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-keybindings').click()
  await win.getByTestId('kb-change-new-terminal').click()
  // Wait until capture is armed (cell shows "Press shortcut…") before pressing, so the chord isn't
  // dropped by the click→press race on slower machines.
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Press shortcut…')
  // Ctrl+Shift+Y (not Ctrl+Shift+N — Chromium reserves that for incognito and swallows the keydown).
  await win.keyboard.press('Control+Shift+Y')
  await win.getByTestId('settings-close').click()
  // Rotation has almost certainly moved past the new-pane tip by now; wait for it to come back, then
  // assert it renders the REBOUND chord. Only this tip can ever contain Ctrl+Shift+Y.
  expect(await newPaneTip(tip)).toContain('Ctrl+Shift+Y')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

/** The rotating tip's width changes every few seconds; it must sit LEFT of the search/notes/orky
 *  buttons so they stay pinned to the right edge instead of shifting with each tip. */
test('status-bar buttons sit right of the rotating tip and never move with it', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tip-order-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  const tip = win.getByTestId('statusbar-tip')
  await expect(tip).toBeVisible()
  const tipBox = await tip.boundingBox()
  const searchBox = await win.getByTestId('search-toggle').boundingBox()
  if (!tipBox || !searchBox) throw new Error('missing status-bar boxes')
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(searchBox.x)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
