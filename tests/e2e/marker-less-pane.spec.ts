// A genuinely MARKER-LESS interactive pane, in-app — the native-ssh status path that had no
// end-to-end coverage. An `ssh` launch override runs verbatim with NO shell-integration
// injection (spawn-spec.ts), so `hasMarkers` stays false forever and StatusTracker's
// output-is-the-only-busy-signal path is the pane's whole status story. status.spec.ts pins the
// no-reflow fix on a LOCAL marker-full PowerShell pane; ssh-quick.spec.ts never observes remote
// output. Here the pane's `launch` is a deterministic marker-less child
// (tests/fixtures/fake-remote-shell.mjs under the harness's node), spawned through the exact
// launch-override path an SSH favorite uses.
//
//   TEST-QA10 — the launch override spawns verbatim: the marker-less prompt renders; the pane
//               carries the launch title.
//   TEST-QA11 — marker-less status progression: real output flips busy, a recognized prompt +
//               quiet flips idle, and the pane then STAYS idle (no busy⇄idle oscillation — the
//               ssh oscillation regression surface, this time on a real marker-less pane).
//   TEST-QA12 — a `[y/N] ` tail reaches needs-input after the quiet window and clears on answer.
//   TEST-QA13 — `exit` marks the pane exited without wedging status.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

const FIXTURE = resolve('tests/fixtures/fake-remote-shell.mjs')

test.describe.serial('marker-less launch-override pane (the native-ssh status path)', () => {
  let app: ElectronApplication
  let win: Page

  test.beforeAll(async () => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-nossh-'))
    const proj = mkdtempSync(join(tmpdir(), 'termh-nossh-proj-'))
    // The exact shape an SSH favorite persists: a terminal pane whose `launch` runs verbatim.
    // process.execPath is the Playwright runner's node — a console app under ConPTY, like ssh.exe.
    seedWorkspace(userData, [{
      paneId: 'p1',
      config: {
        kind: 'terminal', shellId: 'powershell', cwd: proj, name: 'fakebox',
        launch: { command: process.execPath, args: [FIXTURE], title: 'fakebox' }
      }
    }], 'p1')
    app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
      // Shorten the needs-input quiet window (default 10s) the way status.spec.ts does; the
      // marker-less idle thresholds (1.5s prompt / 5s hard) are constants and stay real.
      env: { ...process.env, TERMHALLA_NEEDS_INPUT_QUIET_MS: '2000' }
    })
    win = await app.firstWindow()
    await win.waitForSelector('[data-tab-id]')
  })

  test.afterAll(async () => {
    const pid = app?.process()?.pid
    try { await app?.close() } catch { killTree(pid) }
  })

  test('TEST-QA10 the launch override spawns verbatim and titles the pane', async () => {
    await expect(win.locator('.xterm-rows')).toContainText('fakebox$', { timeout: 30_000 })
    await expect(win.locator('.mosaic-window-title').first()).toContainText('fakebox')
  })

  test('TEST-QA11 busy on real output, idle at the quiet prompt, and NO oscillation after', async () => {
    test.setTimeout(60_000)
    await win.locator('.xterm-screen').click() // hidden mode: focus before typing
    // The typed characters are ConPTY-echoed printable output — the marker-less busy signal.
    await win.keyboard.type('echo marker-less-4471')
    await expect(win.locator('[data-status="busy"]')).toHaveCount(1, { timeout: 5_000 })
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('marker-less-4471', { timeout: 15_000 })
    // Quiet at a recognized prompt (`fakebox$ `) → the heuristic idle fast path.
    await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 15_000 })
    // The regression surface: a repaint/chrome flip must never re-busy a quiet marker-less pane.
    // Sample for 4s — the historical oscillation flipped multiple times per second.
    for (let i = 0; i < 8; i++) {
      await win.waitForTimeout(500)
      await expect(win.locator('[data-status="busy"]')).toHaveCount(0)
    }
    await expect(win.locator('[data-status="idle"]')).toHaveCount(1)
  })

  test('TEST-QA12 a [y/N] tail reaches needs-input and clears on the answer', async () => {
    test.setTimeout(60_000)
    await win.locator('.xterm-screen').click()
    await win.keyboard.type('ask')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('Overwrite? [y/N]', { timeout: 10_000 })
    // quietMs (2s here) of silence at the matching tail → needs-input; the tab badge follows.
    await expect(win.locator('[data-status="needs-input"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('🔔', { timeout: 5_000 })
    await win.keyboard.type('n')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('answered: n', { timeout: 10_000 })
    await expect(win.locator('[data-status="needs-input"]')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TEST-QA13 exit ends the pane without wedging status', async () => {
    await win.locator('.xterm-screen').click()
    await win.keyboard.type('exit')
    await win.keyboard.press('Enter')
    // The pane stays mounted with its scrollback and prints the exit notice (TerminalPane's
    // onPtyExit); node-pty withholds the exit event ~1s (FLUSH_DATA_INTERVAL), hence the margin.
    await expect(win.locator('.xterm-rows')).toContainText('[process exited]', { timeout: 15_000 })
    await expect(win.locator('[data-status="busy"]')).toHaveCount(0, { timeout: 15_000 })
  })
})
