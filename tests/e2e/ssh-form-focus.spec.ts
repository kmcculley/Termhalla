import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

// Opening the SSH form from the command palette is a modal→modal handoff: the palette closes as the
// form opens. The palette's close must NOT bounce focus to the active terminal, or it steals the
// form's autoFocus and the user can't type until they refocus the window. We assert by typing
// immediately (no click): the keystrokes must land in the form's first field, not the terminal.
test('SSH form opened from the palette keeps focus on its first field', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-sshfocus-'))
  const app = await launch(userData)
  const win = await app.firstWindow()

  // An active terminal is the pane focus would (wrongly) be stolen to.
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('new ssh')
  await win.getByTestId('palette-item-0').click()
  await expect(win.getByTestId('connection-form')).toBeVisible()

  // Type WITHOUT clicking the field. If focus was stolen to the terminal this lands in the PTY and
  // conn-name stays empty.
  await win.keyboard.type('keep-focus-box')
  await expect(win.getByTestId('conn-name')).toHaveValue('keep-focus-box', { timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
