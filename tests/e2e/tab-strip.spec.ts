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

/** A crowded tab strip must stay single-line at a constant height. If tab text wraps when the strip
 *  is squeezed, the strip grows, the terminal area shrinks, ConPTY repaints, the status tracker sees
 *  "output", the badge flips, the strip un-wraps — a visible oscillation loop. Constant height makes
 *  the loop impossible: a badge change can never resize the terminal. */
test('crowded tab strip keeps a constant single-line height', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tabstrip-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Pin the window size so "crowded" is deterministic regardless of the machine's display.
  await app.browserWindow(win).then(bw => bw.evaluate(w => { w.setSize(1000, 700); w.center() }))

  const strip = win.getByTestId('workspace-tabs')
  const before = await strip.boundingBox()
  if (!before) throw new Error('no strip box')

  // Crowd the strip: 12 more workspaces (Enter commits each auto-opened rename).
  for (let i = 0; i < 12; i++) {
    await win.getByTestId('new-workspace').click()
    const rename = win.locator('[data-testid^="ws-rename-"]')
    await expect(rename).toBeVisible()
    await rename.press('Enter')
    await expect(rename).toHaveCount(0)
  }
  await expect(win.locator('[data-tab-id]')).toHaveCount(13)

  const after = await strip.boundingBox()
  if (!after) throw new Error('no strip box after')
  expect(after.height).toBe(before.height)

  // No tab may render taller than one line (i.e. no internal text wrap). The active tab is
  // legitimately ~1px taller (its 2px accent border-bottom), so allow that — a wrapped tab
  // would be a whole line (~15px+) taller.
  const tabHeights = await win.locator('[data-tab-id]').evaluateAll(els =>
    els.map(el => (el as unknown as { offsetHeight: number }).offsetHeight))
  const max = Math.max(...tabHeights), min = Math.min(...tabHeights)
  expect(max - min).toBeLessThanOrEqual(2)
  expect(max).toBeLessThanOrEqual(before.height)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
