import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

/** Concatenated contents of every .cast file in the app's recordings dir. */
function castContents(userData: string): string {
  const dir = join(userData, 'recordings')
  if (!existsSync(dir)) return ''
  return readdirSync(dir).filter(f => f.endsWith('.cast')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
}

test('records a terminal session to a .cast file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-rec-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  const rec = win.locator('[data-testid^="rec-"]').first()
  await rec.click() // start
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo rec-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('rec-7788', { timeout: 15_000 })
  await win.waitForTimeout(600)
  await rec.click() // stop -> finalize the .cast

  await expect.poll(() => castContents(userData), { timeout: 10_000 }).toContain('rec-7788')
  // It's a valid asciinema v2 cast (header line parses with version 2).
  const dir = join(userData, 'recordings')
  const file = readdirSync(dir).find(f => f.endsWith('.cast'))!
  const header = JSON.parse(readFileSync(join(dir, file), 'utf8').split('\n')[0]) as { version: number }
  expect(header.version).toBe(2)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
