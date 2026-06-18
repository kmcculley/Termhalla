import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

test('command palette: create a connection, launch it, and jump to a recent dir', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ssh-'))
  const seededDir = mkdtempSync(join(tmpdir(), 'termh-sshdir-'))
  mkdirSync(join(seededDir, 'leaf'))

  // Seed quick.json with one recent directory so the palette has a dir entry to launch.
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'quick.json'), JSON.stringify({
    connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [seededDir]
  }), 'utf8')

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const app: ElectronApplication = await launch()
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Open the palette and create a connection via the form.
  await win.keyboard.press('Control+K')
  await expect(win.getByTestId('command-palette')).toBeVisible()
  await win.getByTestId('palette-input').fill('new ssh')
  await expect(win.getByTestId('palette-item-0')).toContainText('New SSH connection')
  await win.getByTestId('palette-item-0').click()             // "New SSH connection…"
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await win.getByTestId('conn-name').fill('my-box')
  await win.getByTestId('conn-host').fill('example.com')
  await win.getByTestId('conn-user').fill('kev')
  await win.getByTestId('conn-save').click()
  await expect(win.getByTestId('connection-form')).toBeHidden()

  // Re-open the palette: the new connection appears and launches an SSH terminal pane.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('my-box')
  await expect(win.getByTestId('palette-item-0')).toContainText('my-box')
  await win.getByTestId('palette-item-0').click()
  // A terminal pane titled with the connection name now exists.
  await expect(win.locator('.mosaic-window-title', { hasText: 'my-box' }).first()).toBeVisible({ timeout: 15_000 })

  // Open the palette again and launch the seeded recent directory -> a local terminal cwd'd there.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('termh-sshdir')
  await win.getByTestId('palette-item-0').click()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(seededDir)}"]`))
    .toHaveCount(1, { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('ssh form: enabling tmux persists the session and round-trips into edit', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tmux-'))
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'quick.json'), JSON.stringify({
    connections: [], recentConnections: [], favoriteDirs: [], recentDirs: []
  }), 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Create a connection with tmux enabled.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('new ssh')
  await win.getByTestId('palette-item-0').click()
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await win.getByTestId('conn-name').fill('tmux-box')
  await win.getByTestId('conn-host').fill('example.com')
  await win.getByTestId('conn-user').fill('kev')
  // The session input is hidden until the checkbox is on.
  await expect(win.getByTestId('conn-tmux-session')).toBeHidden()
  await win.getByTestId('conn-tmux').check()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('main') // default
  await win.getByTestId('conn-tmux-session').fill('work')
  await win.getByTestId('conn-save').click()
  await expect(win.getByTestId('connection-form')).toBeHidden()

  // Re-open the connection in the edit form: the checkbox is on and the name round-trips.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('tmux-box')
  await expect(win.getByTestId('palette-item-0')).toContainText('tmux-box')
  await win.getByTestId('palette-item-0').getByTitle('Edit').click()
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await expect(win.getByTestId('conn-tmux')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('work')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
