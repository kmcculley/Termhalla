import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
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
