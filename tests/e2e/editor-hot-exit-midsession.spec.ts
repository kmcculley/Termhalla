import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

// Reproduces the user's exact manual test: type, wait, check editor-drafts.json WITHOUT closing.
test('writes the draft to disk mid-session (no close)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-mid-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-midproj-'))
  const file = join(proj, 'hello.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('const a = 1', { timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// MIDSESSION-DRAFT\n')
  await expect(win.locator('.view-lines')).toContainText('MIDSESSION-DRAFT', { timeout: 10_000 })

  // Wait well past the 500ms debounce — NO close.
  await win.waitForTimeout(3000)

  const draftsPath = join(userData, 'editor-drafts.json')
  const raw = existsSync(draftsPath) ? readFileSync(draftsPath, 'utf8') : '(missing)'
  // eslint-disable-next-line no-console
  console.log('MIDSESSION editor-drafts.json =', raw)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  expect(raw).toContain('MIDSESSION-DRAFT')
})
