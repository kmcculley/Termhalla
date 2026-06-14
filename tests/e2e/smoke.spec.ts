import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'

/**
 * Kill the Electron process and its entire Windows process tree (including
 * node-pty child processes such as conhost.exe / winpty-agent.exe that keep
 * stdio pipes open and prevent Playwright's gracefullyCloseAll from returning).
 */
function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      // /F = force, /T = terminate tree (all children)
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Process may already be gone
  }
}

// Custom fixture: launches Electron and kills the entire process tree after
// the test body so that node-pty child processes on Windows are also terminated.
const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu']
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

test('launches, opens a terminal, echoes input', async ({ app }) => {
  const win = await app.firstWindow()

  await win.getByTestId('add-first-terminal').click()
  // a terminal tile mounts
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // type a command into the focused xterm and expect to see the echoed text
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo termhalla-ok')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('termhalla-ok', { timeout: 15_000 })

  await win.screenshot({ path: 'test-results/smoke-terminal.png' })
})

test('split creates a second terminal tile', async ({ app }) => {
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  const split = win.locator('[data-testid^="split-"]').first()
  await split.click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.screenshot({ path: 'test-results/smoke-split.png' })
})
