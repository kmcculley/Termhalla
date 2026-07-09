// The e2e harness must never present a window. `playwright.config.ts` defaults
// TERMHALLA_E2E_WINDOW=hidden and `window-manager.ts` skips presentation on 'ready-to-show', but the
// suite launches one app per spec (~190 across a ~13 minute run) — so a single ungated `show()` on
// any path turns the whole run back into a stream of interruptions over the developer's work.
//
// These specs inherit the harness default (no explicit env), so they assert the real shipped
// configuration rather than a mode they set up themselves.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

const launch = (userData: string): Promise<ElectronApplication> => electron.launch({
  args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
})

/** Visibility of every window main owns, straight from the main process. */
const visibilities = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.isVisible()))

test('no window is presented, yet the renderer is laid out and scriptable', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-present-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Never presented...
  expect(await visibilities(app)).toEqual([false])

  // ...but laid out: a never-shown window still measures. This is what lets the layout-measuring
  // specs (Monaco, xterm's FitAddon, the toolbar boxes) pass under `hidden`.
  const box = await win.getByTestId('workspace-tabs').boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// The standing risk of never showing a window: Chromium treats it as a background window and
// throttles the timers/rAF that xterm's render loop rides, so rows would never paint and every
// terminal spec would hang on its output assertion. `backgroundThrottling: false` is what prevents
// that; this drives a real PTY end-to-end to prove it, and would fail if that option were dropped.
test('a hidden window still paints terminal output (backgroundThrottling is off)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-present-rows-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo paint9931')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('paint9931', { timeout: 15_000 })

  // Spawning a terminal (and typing into it) presented nothing.
  expect(await visibilities(app)).toEqual([false])

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
