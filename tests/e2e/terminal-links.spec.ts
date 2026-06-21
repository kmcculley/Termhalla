import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

test('Ctrl+click a local image path opens the lightbox; Esc closes it', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-links-'))
  const imgPath = join(userData, 'pic.png')
  writeFileSync(imgPath, Buffer.from(PNG_B64, 'base64'))

  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Echo the absolute image path so it renders in the buffer, then Ctrl+click it.
  await win.keyboard.type(`echo ${imgPath}`)
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('pic.png', { timeout: 15_000 })

  await win.keyboard.down('Control')
  await win.getByText(imgPath, { exact: false }).last().click()
  await win.keyboard.up('Control')

  await expect(win.getByTestId('image-lightbox-img')).toBeVisible({ timeout: 15_000 })
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('image-lightbox')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
