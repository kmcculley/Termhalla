import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('explorer lists files, opens one in the editor, and reflects external creates', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ex-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-exproj-'))
  writeFileSync(join(proj, 'readme.md'), '# hello world', 'utf8')
  // a workspace with an explorer (left) and an empty editor (right), tiled
  seedWorkspace(userData,
    [{ paneId: 'pe', config: { kind: 'explorer', root: proj } },
     { paneId: 'ed', config: { kind: 'editor', files: [] } }],
    { direction: 'row', first: 'pe', second: 'ed' })

  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()

  // tree shows the seeded file
  await expect(win.getByTestId('entry-readme.md')).toBeVisible({ timeout: 20_000 })
  // clicking it opens it in the editor with content
  await win.getByTestId('entry-readme.md').click()
  await expect(win.locator('.view-lines')).toContainText('hello world', { timeout: 15_000 })
  // an externally-created file appears live
  writeFileSync(join(proj, 'new-file.txt'), 'x', 'utf8')
  await expect(win.getByTestId('entry-new-file.txt')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
