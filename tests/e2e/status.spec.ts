import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* gone */ }
}

const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-status-'))
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
      env: { ...process.env, TERMHALLA_NEEDS_INPUT_QUIET_MS: '2000' }
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

async function openTerminal(win: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
}

test('a running command shows busy then returns to idle', async ({ app }) => {
  const win = await app.firstWindow()
  await openTerminal(win)
  await win.keyboard.type('Start-Sleep -Seconds 2; "done"')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="busy"]')).toHaveCount(1, { timeout: 5_000 })
  await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 15_000 })
})

// The busy<->idle oscillation on ssh/agent panes. The idle toolbar rule carried a `border-bottom:
// 1px` the busy rule lacked; the toolbar is content-box with a fixed height, so idle stood 31px to
// busy's 30px. Each status flip resized the terminal host by 1px -> refit xterm -> resized the PTY ->
// full-screen repaint -> re-marked a marker-less pane busy -> border gone -> resized again, forever.
// A pane's status must be PAINT-only. Measured here on the real box; the CSS is also pinned
// structurally by tests/renderer/pane-status-css.test.ts.
test('the pane toolbar is exactly the same size busy and idle (no status-driven reflow)', async ({ app }) => {
  const win = await app.firstWindow()
  await openTerminal(win)
  const toolbar = win.locator('.mosaic-window-toolbar').first()
  const host = win.locator('[data-testid^="terminal-"]').first()

  await win.keyboard.type('Start-Sleep -Seconds 3; "done"')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="busy"]')).toHaveCount(1, { timeout: 5_000 })
  const busyToolbar = await toolbar.boundingBox()
  const busyHost = await host.boundingBox()

  await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 20_000 })
  const idleToolbar = await toolbar.boundingBox()
  const idleHost = await host.boundingBox()

  expect(idleToolbar!.height, 'idle toolbar must not be taller than the busy one').toBe(busyToolbar!.height)
  expect(idleHost!.height, 'the terminal host must not be resized by a status change').toBe(busyHost!.height)
})

test('a y/N prompt triggers needs-input and a tab badge', async ({ app }) => {
  test.setTimeout(40_000)
  const win = await app.firstWindow()
  await openTerminal(win)
  await win.keyboard.type('Write-Host -NoNewline "Overwrite? [y/N] "; $null = [Console]::ReadLine()')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="needs-input"]')).toHaveCount(1, { timeout: 20_000 })
  await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('🔔', { timeout: 5_000 })
  // Readability: the orange needs-input bar uses the dark adaptive title color (#182026),
  // not white (which was 2.29:1 on #ff8f00).
  const titleColor = await win.locator('.mosaic-window.term-needs-input .mosaic-window-title').first()
    .evaluate(el => {
      const g = globalThis as unknown as { getComputedStyle(e: unknown): { color: string } }
      return g.getComputedStyle(el).color
    })
  expect(titleColor).toBe('rgb(24, 32, 38)')
  await win.keyboard.type('n')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="needs-input"]')).toHaveCount(0, { timeout: 10_000 })
})

test('per-terminal settings: rename + mute the status border', async ({ app }) => {
  const win = await app.firstWindow()
  await openTerminal(win)
  await win.locator('[data-testid^="titlebar-"]').first().click({ button: 'right', position: { x: 30, y: 13 } })
  await win.getByTestId('pane-menu-settings').click()
  await win.getByTestId('setting-name').fill('build')
  await win.getByTestId('setting-border').uncheck()
  await win.getByTestId('settings-close').click()
  await expect(win.locator('.mosaic-window.term-status')).toHaveCount(0)
  await expect(win.locator('.mosaic-window-title').first()).toContainText('build')
})
