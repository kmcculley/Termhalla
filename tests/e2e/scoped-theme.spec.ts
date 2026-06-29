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

// Read a CSS custom property off :root (no DOM lib in the test tsconfig — cast globalThis).
function rootVar(win: Page, name: string): Promise<string> {
  return win.evaluate((n) => {
    const g = globalThis as unknown as { getComputedStyle: (e: unknown) => { getPropertyValue: (k: string) => string }, document: { documentElement: unknown } }
    return g.getComputedStyle(g.document.documentElement).getPropertyValue(n).trim()
  }, name)
}
// Read a CSS custom property off the first element matching a selector.
function selVar(win: Page, selector: string, name: string): Promise<string> {
  return win.evaluate(({ selector, name }) => {
    const g = globalThis as unknown as { getComputedStyle: (e: unknown) => { getPropertyValue: (k: string) => string }, document: { querySelector: (s: string) => unknown } }
    const el = g.document.querySelector(selector)
    return el ? g.getComputedStyle(el).getPropertyValue(name).trim() : ''
  }, { selector, name })
}
// Set a color input's value via the native setter so React's onChange/onInput fire.
async function setColor(win: Page, testid: string, value: string): Promise<void> {
  await win.getByTestId(testid).evaluate((el, v) => {
    const i = el as unknown as { value: string; dispatchEvent: (e: unknown) => void }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set as ((this: unknown, x: string) => void) | undefined
    if (setter) setter.call(el, v); else i.value = v
    const G = globalThis as unknown as { Event: new (t: string, o?: { bubbles: boolean }) => unknown }
    i.dispatchEvent(new G.Event('input', { bubbles: true }))
  }, value)
}

test('scoped theming: app vs per-pane override, persisted', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-scopedtheme-'))
  let app = await launch(userData)
  let win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('settings-appearance')).toBeVisible()

  // App scope: window background updates :root --bg.
  await setColor(win, 'theme-windowBg', '#7733aa')
  await expect.poll(() => rootVar(win, '--bg'), { timeout: 10_000 }).toBe('#7733aa')

  // Switch scope to the pane (options: app=0, workspace=1, pane=2) and override the terminal background.
  await win.getByTestId('theme-scope').selectOption({ index: 2 })
  await setColor(win, 'theme-termBg', '#22aa55')
  // The override lands on the pane tile, NOT on :root.
  await expect.poll(() => selVar(win, '[data-testid^="tile-"]', '--term-bg'), { timeout: 10_000 }).toBe('#22aa55')
  expect(await rootVar(win, '--term-bg')).not.toBe('#22aa55')

  // Close, let autosave flush, relaunch.
  await win.getByTestId('settings-close').click()
  await win.waitForTimeout(1500)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  // App window bg persisted (quick.json) and the pane override persisted (workspace JSON).
  await expect.poll(() => rootVar(win, '--bg'), { timeout: 12_000 }).toBe('#7733aa')
  await expect.poll(() => selVar(win, '[data-testid^="tile-"]', '--term-bg'), { timeout: 12_000 }).toBe('#22aa55')
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('the pane Settings menu opens Appearance scoped to that pane', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-panetheme-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  // Open Appearance from THIS pane's right-click Settings menu → starts scoped to the pane.
  await win.locator('[data-testid^="titlebar-"]').first().click({ button: 'right', position: { x: 30, y: 13 } })
  await win.getByTestId('pane-menu-settings').click()
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('settings-appearance')).toBeVisible()
  expect(await win.getByTestId('theme-scope').inputValue()).toMatch(/^pane:/)

  // Editing applies to that pane only.
  await setColor(win, 'theme-termBg', '#0099cc')
  await expect.poll(() => selVar(win, '[data-testid^="tile-"]', '--term-bg'), { timeout: 10_000 }).toBe('#0099cc')
  expect(await rootVar(win, '--term-bg')).not.toBe('#0099cc')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
