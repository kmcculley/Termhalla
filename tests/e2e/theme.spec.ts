import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
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

// Read a CSS custom property off :root. The test tsconfig has no DOM lib, so the
// evaluate callback reaches DOM globals through a structural cast on globalThis.
function cssVar(win: Page, name: string): Promise<string> {
  return win.evaluate((n) => {
    const g = globalThis as unknown as {
      getComputedStyle: (e: unknown) => { getPropertyValue: (k: string) => string }
      document: { documentElement: unknown }
    }
    return g.getComputedStyle(g.document.documentElement).getPropertyValue(n).trim()
  }, name)
}

// Set a <input type="color"> value and fire the input event React's onChange listens for.
// Uses the NATIVE prototype value setter so React's controlled-input value tracker doesn't
// swallow the change (setting el.value directly would update the tracker and skip onChange).
async function setColor(win: Page, testid: string, value: string): Promise<void> {
  await win.getByTestId(testid).evaluate((el, v) => {
    const i = el as unknown as { value: string; dispatchEvent: (e: unknown) => void }
    const proto = Object.getPrototypeOf(el)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set as ((this: unknown, x: string) => void) | undefined
    if (setter) setter.call(el, v); else i.value = v
    const G = globalThis as unknown as { Event: new (t: string, o?: { bubbles: boolean }) => unknown }
    i.dispatchEvent(new G.Event('input', { bubbles: true }))
  }, value)
}

test('customizes the theme, persists it across relaunch, and supports presets', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-theme-'))
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('settings-appearance')).toBeVisible()

  // Change the window background to a distinctive color → the CSS var updates live.
  await setColor(win, 'theme-windowBg', '#7733aa')
  await expect.poll(() => cssVar(win, '--bg'), { timeout: 10_000 }).toBe('#7733aa')

  // Save a preset, reset to default (var changes), then re-apply the preset (var returns).
  await win.getByTestId('theme-preset-name').fill('Purple')
  await win.getByTestId('theme-save-preset').click()
  await win.getByTestId('theme-reset').click()
  await expect.poll(() => cssVar(win, '--bg'), { timeout: 10_000 }).not.toBe('#7733aa')
  await win.locator('[data-testid^="theme-preset-"]', { hasText: 'Purple' }).click()
  await expect.poll(() => cssVar(win, '--bg'), { timeout: 10_000 }).toBe('#7733aa')

  // Close the panel and let the debounced quick.json save flush.
  await win.getByTestId('settings-close').click()
  await win.waitForTimeout(1500)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Relaunch: the customized theme persists from quick.json.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => cssVar(win, '--bg'), { timeout: 12_000 }).toBe('#7733aa')
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
