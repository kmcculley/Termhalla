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

// The tab-bar shell picker ("terminal type") and "+ pane" menu ("pane type") are native <select>s.
// Their <option> popups inherit the light chrome text on Chromium's default-light popup background,
// rendering white-on-white. We theme <option> so the popup is legible; assert the options resolve to
// a non-transparent themed background that contrasts with their text.
test('native select option popups have a themed, legible background', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-selcontrast-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click() // ensure the tab bar (with the pickers) is present
  await expect(win.getByTestId('shell-picker')).toBeVisible({ timeout: 15_000 })

  for (const sel of ['shell-picker', 'add-pane']) {
    const styles = await win.locator(`[data-testid="${sel}"] option`).first().evaluate(el => {
      const g = globalThis as unknown as { getComputedStyle(e: unknown): { color: string; backgroundColor: string } }
      const s = g.getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor }
    })
    expect(styles.bg, `${sel} option background`).not.toBe('rgba(0, 0, 0, 0)') // themed, not transparent
    expect(styles.color, `${sel} option contrast`).not.toBe(styles.bg)          // text != background
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
