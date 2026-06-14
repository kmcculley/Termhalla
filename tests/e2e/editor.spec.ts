import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('opens a seeded file in Monaco, edits, and saves to disk', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj-'))
  const file = join(proj, 'hello.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await expect(win.locator('.view-lines')).toContainText('const a = 1', { timeout: 15_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// edited\n')
  await win.keyboard.press('Control+S')
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10_000 }).toContain('// edited')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('Ctrl+S saves the active tab after switching tabs', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed3-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj3-'))
  const a = join(proj, 'a.ts'); const b = join(proj, 'b.ts')
  writeFileSync(a, 'AAA\n', 'utf8'); writeFileSync(b, 'BBB\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [a, b], activePath: a } }], 'p1')
  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  // switch to tab b
  await win.getByTestId('tab-b.ts').click()
  await expect(win.locator('.view-lines')).toContainText('BBB', { timeout: 10_000 })
  // edit + save
  await win.locator('.view-lines').click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// in-b\n')
  await win.keyboard.press('Control+S')
  // b changed, a unchanged
  await expect.poll(() => readFileSync(b, 'utf8'), { timeout: 10_000 }).toContain('// in-b')
  expect(readFileSync(a, 'utf8')).toBe('AAA\n')
  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('reloads a clean open file when it changes on disk', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj2-'))
  const file = join(proj, 'note.txt')
  writeFileSync(file, 'original', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')
  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('original', { timeout: 20_000 })
  writeFileSync(file, 'changed externally', 'utf8')
  await expect(win.locator('.view-lines')).toContainText('changed externally', { timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('marks a tab deleted when its file is removed on disk', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed4-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj4-'))
  const file = join(proj, 'gone.txt')
  writeFileSync(file, 'temporary', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')
  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('temporary', { timeout: 20_000 })
  rmSync(file)
  await expect(win.getByTestId('tab-gone.txt')).toContainText('(deleted)', { timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
