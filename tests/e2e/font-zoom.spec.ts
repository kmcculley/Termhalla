import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

test('Ctrl+wheel zooms the terminal font size', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-zoom-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  const term = win.locator('[data-testid^="terminal-"]').first()
  await expect(term).toBeVisible({ timeout: 15_000 })

  // Ctrl + wheel up zooms in one notch (default size is 13). No DOM lib in the test tsconfig — cast.
  await term.evaluate(el => {
    const node = el as unknown as { dispatchEvent: (e: unknown) => void }
    const G = globalThis as unknown as {
      WheelEvent: new (t: string, o: { deltaY: number; ctrlKey: boolean; bubbles: boolean; cancelable: boolean }) => unknown
    }
    node.dispatchEvent(new G.WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
  })

  // The global terminal font size should now read 14 in Appearance settings.
  await win.keyboard.press('Control+Comma')
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('theme-termFontSize')).toHaveValue('14', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// A font change re-grids xterm (new cell size => new cols/rows) via FitAddon.fit(). `fit()` resizes
// xterm internally and nothing listens to term.onResize, so unless the font effect explicitly pushes
// the new grid, the PTY keeps the OLD one: the program then draws at the old width into a terminal of
// a new width and renders garbled — output Ctrl+L cannot fix (it just redraws at the same wrong
// width), which is why maximizing the pane appeared to cure it. Pins `syncGrid` in the theme effect.
test('a font zoom pushes the new grid to the PTY (xterm/PTY stay in sync)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-zoom-sync-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  const term = win.locator('[data-testid^="terminal-"]').first()
  await expect(term).toBeVisible({ timeout: 15_000 })

  // Observe the real IPC in main (an extra listener alongside the app's own — no app code touched).
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __resizes: Array<{ cols: number; rows: number }> }
    g.__resizes = []
    ipcMain.on('pty:resize', (_e, a: { cols: number; rows: number }) => { g.__resizes.push(a) })
  })
  // Let the pane's initial fit/ResizeObserver settle, then start from a clean slate.
  await win.waitForTimeout(1_000)
  await app.evaluate(() => { (globalThis as unknown as { __resizes: unknown[] }).__resizes = [] })

  // Zoom in two notches: 13 -> 15px. A bigger cell means strictly fewer rows AND columns.
  for (let i = 0; i < 2; i++) {
    await term.evaluate(el => {
      const node = el as unknown as { dispatchEvent: (e: unknown) => void }
      const G = globalThis as unknown as {
        WheelEvent: new (t: string, o: { deltaY: number; ctrlKey: boolean; bubbles: boolean; cancelable: boolean }) => unknown
      }
      node.dispatchEvent(new G.WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
    })
  }

  // The PTY must have been told about the smaller grid. Before the fix this array stayed empty:
  // the font effect called fit() with no matching ptyResize.
  await expect.poll(
    () => app.evaluate(() => (globalThis as unknown as { __resizes: unknown[] }).__resizes.length),
    { timeout: 10_000, message: 'a font zoom must resize the PTY to the newly-fitted grid' }
  ).toBeGreaterThan(0)

  const resizes = await app.evaluate(() => (globalThis as unknown as { __resizes: Array<{ cols: number; rows: number }> }).__resizes)
  const last = resizes[resizes.length - 1]
  expect(last.cols).toBeGreaterThan(0)
  expect(last.rows).toBeGreaterThan(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
