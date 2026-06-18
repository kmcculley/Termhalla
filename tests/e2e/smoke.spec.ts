import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Process may already be gone
  }
}

const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-smoke-'))
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

test('launches, opens a terminal, echoes input', async ({ app }) => {
  const win = await app.firstWindow()

  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo termhalla-ok')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('termhalla-ok', { timeout: 15_000 })

  await win.screenshot({ path: 'test-results/smoke-terminal.png' })
})

test('split menu creates a second terminal tile', async ({ app }) => {
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()      // opens the split menu
  await win.locator('[data-testid^="split-terminal-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.screenshot({ path: 'test-results/smoke-split.png' })
})

test('vertical split menu creates a second terminal tile', async ({ app }) => {
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-col-"]').first().click() // opens the split-down menu
  await win.locator('[data-testid^="split-terminal-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
})

test('shell picker lists discovered shells and opens the chosen one', async ({ app }) => {
  const win = await app.firstWindow()
  const picker = win.getByTestId('shell-picker')
  await expect(picker).toBeVisible()
  const values = await picker.locator('option').evaluateAll(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts => opts.map(o => (o as any).value as string)
  )
  expect(values.length).toBeGreaterThanOrEqual(1)
  await picker.selectOption(values[values.length - 1])
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
})
