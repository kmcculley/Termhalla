// FROZEN e2e suite — feature 0003-pane-minimize-restore (phase 4 / REQ-005 + REQ-014).
// REQ-005: a tray chip surfaces the minimized pane's LIVE status — a backgrounded pane blocking on
// input must be visibly distinguishable (`data-needs-input="1"`). REQ-014: chips are keyboard-operable
// focusable controls with an accessible name. Runs RED until the feature ships. Requires `npm run build`.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function launchWithTerminal(prefix: string): Promise<{ app: ElectronApplication; win: Page; paneId: string }> {
  const userData = mkdtempSync(join(tmpdir(), prefix))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const tid = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  return { app, win, paneId: tid!.replace('tile-', '') }
}

// TEST-033 — REQ-005: a minimized pane blocking on input carries `data-needs-input="1"` on its chip
// (live status while off-layout) — the not-a-silent-footgun guarantee.
test('TEST-033 REQ-005 a minimized pane blocking on input marks its chip needs-input', async () => {
  test.setTimeout(60_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-needsinput-')
  await win.locator('.xterm-screen').first().click()
  // Emit a recognized prompt so main-side needs-input detection fires (mirrors status.spec.ts).
  await win.keyboard.type('Write-Host -NoNewline "Overwrite? [y/N] "; $null = [Console]::ReadLine()')
  await win.keyboard.press('Enter')

  await win.getByTestId(`min-${paneId}`).click()
  await expect(win.getByTestId(`min-chip-${paneId}`)).toBeVisible({ timeout: 10_000 })
  // The chip reflects the live blocked state even while the pane is off-layout.
  await expect(win.getByTestId(`min-chip-${paneId}`)).toHaveAttribute('data-needs-input', '1', { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-034 — REQ-014: chips are real focusable controls with an accessible name, restorable by
// keyboard (Enter).
test('TEST-034 REQ-014 tray chips are focusable, named, and keyboard-activatable', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-a11y-')
  await win.getByTestId(`min-${paneId}`).click()
  const chip = win.getByTestId(`min-chip-${paneId}`)
  await expect(chip).toBeVisible({ timeout: 10_000 })

  // Focusable with a non-empty accessible name (pane title + status).
  await chip.focus()
  await expect(chip).toBeFocused()
  const name = (await chip.getAttribute('aria-label')) || (await chip.textContent()) || ''
  expect(name.trim().length).toBeGreaterThan(0)

  // Keyboard activation (Enter) restores the pane.
  await win.keyboard.press('Enter')
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
