import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* already gone */ }
}

const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-clip-'))
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

async function openTerminal(app: ElectronApplication) {
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  return win
}

test('copies a selected line with Ctrl+C', async ({ app }) => {
  const win = await openTerminal(app)
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo CLIP-COPY-TOKEN')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('CLIP-COPY-TOKEN', { timeout: 15_000 })

  // Triple-click the echoed output line to select it, then copy.
  await win.locator('.xterm-rows').getByText('CLIP-COPY-TOKEN', { exact: false }).first()
    .click({ clickCount: 3 })
  await win.keyboard.press('Control+c')

  await expect.poll(
    () => app.evaluate(({ clipboard }) => clipboard.readText()),
    { timeout: 5_000 }
  ).toContain('CLIP-COPY-TOKEN')
})

test('pastes the clipboard with Ctrl+V', async ({ app }) => {
  const win = await openTerminal(app)
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTE-V-TOKEN'))
  await win.locator('.xterm-screen').click()
  await win.keyboard.press('Control+v')
  await expect(win.locator('.xterm-rows')).toContainText('PASTE-V-TOKEN', { timeout: 15_000 })
})

test('Ctrl+V pastes exactly once (no double paste)', async ({ app }) => {
  const win = await openTerminal(app)
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTEONCETOKEN'))
  await win.locator('.xterm-screen').click()
  await win.keyboard.press('Control+v')
  // Wait for the paste to land before doing anything else (mirrors the proven Ctrl+V test above;
  // typing immediately would race the async clipboard read).
  await expect(win.locator('.xterm-rows')).toContainText('PASTEONCETOKEN', { timeout: 15_000 })
  // Type a sentinel AFTER the paste. Both paste copies (the custom handler's term.paste and, when
  // the bug is present, the browser's native paste event) are dispatched to the PTY before this
  // keystroke; the PTY is FIFO, so once the sentinel renders every paste byte has flushed and the
  // count reflects the final state.
  await win.keyboard.type('ZZSENT')
  await expect(win.locator('.xterm-rows')).toContainText('ZZSENT', { timeout: 5_000 })
  // The custom Ctrl+V handler must preventDefault so the browser's native paste event does not
  // ALSO fire xterm's built-in paste listener — otherwise the token lands twice.
  const text = await win.locator('.xterm-rows').textContent()
  const count = (text?.match(/PASTEONCETOKEN/g) || []).length
  expect(count).toBe(1)
})

test('pastes the clipboard on right-click', async ({ app }) => {
  const win = await openTerminal(app)
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTE-RMB-TOKEN'))
  await win.locator('.xterm-screen').click({ button: 'right' })
  await expect(win.locator('.xterm-rows')).toContainText('PASTE-RMB-TOKEN', { timeout: 15_000 })
})
