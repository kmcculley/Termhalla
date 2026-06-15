import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

test('restores an unsaved editor draft after relaunch', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-hotexit-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-hotproj-'))
  const file = join(proj, 'hello.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  // Session 1: open the seeded file, type unsaved text, DON'T save.
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('const a = 1', { timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// UNSAVED-DRAFT\n')
  await expect(win.locator('.view-lines')).toContainText('UNSAVED-DRAFT', { timeout: 10_000 })
  await win.waitForTimeout(900) // let the debounced draftSet flush to disk
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Session 2: relaunch -> the unsaved draft is restored and the tab is dirty.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('UNSAVED-DRAFT', { timeout: 20_000 })
  await expect(win.getByTestId('tab-hello.ts')).toContainText('•', { timeout: 10_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('shows the changed-on-disk bar when a drafted file changed while closed', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-hotexit2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-hotproj2-'))
  const file = join(proj, 'note.txt')
  writeFileSync(file, 'original\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('original', { timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('DRAFTED ')
  await win.waitForTimeout(900)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Change the file on disk while the app is closed.
  writeFileSync(file, 'changed on disk\n', 'utf8')

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('DRAFTED', { timeout: 20_000 })
  await expect(win.getByTestId('editor-reloadbar')).toBeVisible({ timeout: 10_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
