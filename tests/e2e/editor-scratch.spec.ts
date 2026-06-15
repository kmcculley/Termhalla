import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string, env?: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, ...(env ?? {}) } as { [key: string]: string }
  })
}

test('restores an untitled scratch buffer after relaunch', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-scratch-'))
  // Editor pane with NO file open — the scratch case.
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [] } }], 'p1')

  // Session 1: type into the untitled buffer, do NOT save.
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('tab-untitled')).toBeVisible({ timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.type('scratch-note-9911\n')
  await expect(win.locator('.view-lines')).toContainText('scratch-note-9911', { timeout: 10_000 })
  await win.waitForTimeout(900) // debounce flush
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Session 2: relaunch (same userData, NOT re-seeded) -> scratch restored, tab dirty.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('scratch-note-9911', { timeout: 20_000 })
  await expect(win.getByTestId('tab-untitled')).toContainText('•', { timeout: 10_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Save As turns an untitled buffer into a real file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-scratch2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-scratchproj-'))
  const target = join(proj, 'saved-note.txt')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [] } }], 'p1')

  const app = await launch(userData, { TERMHALLA_SAVE_PATH: target })
  const win = await app.firstWindow()
  await expect(win.getByTestId('tab-untitled')).toBeVisible({ timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.type('save-me-4242')
  await expect(win.getByTestId('untitled-saveas')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('Control+S')

  // The file is written, and a real file tab appears.
  await expect.poll(() => { try { return readFileSync(target, 'utf8') } catch { return '' } },
    { timeout: 10_000 }).toContain('save-me-4242')
  await expect(win.getByTestId('tab-saved-note.txt')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
