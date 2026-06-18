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
  await win.getByTestId('settings-button').click()
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('theme-termFontSize')).toHaveValue('14', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
