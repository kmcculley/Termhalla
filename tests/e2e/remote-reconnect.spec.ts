// Transport drop → reconnect → the session SURVIVES, in-app. The F18 session store + F23
// per-workspace daemon promise exactly this (`tmux` semantics: the client dies, the work
// doesn't); the vitest integration suites prove it at the manager level, and this spec proves
// the app renders it: the banner surfaces the loss, Reconnect reattaches THE SAME daemon (no
// second daemon-spawn in the shim ledger), and the pane is live again with its history intact.
//
// The drop is honest: the spec kills the fake-ssh shim process (the app's real transport child),
// exactly what a dead network/ssh does to production — not a polite in-app disconnect.
//
//   TEST-QA20 — connect, produce unique output, kill the transport: the banner lands
//               "connection lost" with Reconnect; the pane stays mounted under it.
//   TEST-QA21 — Reconnect: banner clears, the ledger shows a reattach (daemon-attach grew,
//               daemon-spawn did NOT), the pre-drop output is still in the pane exactly once
//               (no replay duplication), and the SAME session answers new input.
import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchWithShim, createRemoteWorkspace, closeRemoteApp } from './remote-harness'

/** Kill every fake-ssh shim process — the transport, not the daemon (which the bridge spawned
 *  DETACHED and must survive to make the reconnect meaningful). Matched by command line, NOT by
 *  ParentProcessId: Playwright's `app.process().pid` is a launcher process, not the Electron main
 *  that spawns the wire (measured — a parent-filtered kill matched nothing and the drop never
 *  happened). Safe under the suite's single-worker discipline: only this spec's shim exists. */
function killTransport(): void {
  execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ` +
    `Where-Object { $_.CommandLine -like '*fake-ssh.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
    { timeout: 15_000 }
  )
}

test.describe.serial('remote transport drop → reconnect survival (daemon reattach)', () => {
  let app: ElectronApplication
  let win: Page
  let fakeHome: string
  let ledgerPath: string

  const ledger = (): Array<{ kind: string }> =>
    readFileSync(ledgerPath, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { kind: string })

  test.beforeAll(async () => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-remr-'))
    fakeHome = mkdtempSync(join(tmpdir(), 'termh-remr-home-'))
    ledgerPath = join(fakeHome, 'ssh-ledger.jsonl')
    app = await launchWithShim(userData, fakeHome)
    win = await app.firstWindow()
    await win.waitForSelector('[data-tab-id]')
  })

  test.afterAll(async () => {
    await closeRemoteApp(app, fakeHome)
  })

  test('TEST-QA20 killing the transport lands the banner on connection-lost, pane kept mounted', async () => {
    test.setTimeout(120_000)
    await createRemoteWorkspace(win, 'e2e-reconnect-agent')
    await expect(win.locator('.xterm-rows')).toContainText('fake$', { timeout: 45_000 })
    await expect(win.getByTestId('remote-banner')).toHaveCount(0)

    // Unique pre-drop output the reconnect must preserve.
    await win.locator('.xterm-screen').click()
    await win.keyboard.type('echo survive-alpha-3317')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('survive-alpha-3317', { timeout: 15_000 })

    killTransport()

    const banner = win.getByTestId('remote-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText(/lost/i)
    await expect(win.getByTestId('remote-reconnect')).toBeVisible()
    // Keep-mounted: the frozen pane (and its scrollback) is still under the banner.
    await expect(win.locator('.mosaic-window')).toHaveCount(1)
    await expect(win.locator('.xterm-rows')).toContainText('survive-alpha-3317')
  })

  test('TEST-QA21 Reconnect reattaches the SAME daemon; history intact, session live', async () => {
    test.setTimeout(120_000)
    const attachesBefore = ledger().filter(e => e.kind === 'daemon-attach').length
    expect(ledger().filter(e => e.kind === 'daemon-spawn')).toHaveLength(1)

    await win.getByTestId('remote-reconnect').click()
    await expect(win.getByTestId('remote-banner')).toHaveCount(0, { timeout: 45_000 })

    // The reattach went through the daemon flow again — against the ALREADY-RUNNING daemon.
    expect(ledger().filter(e => e.kind === 'daemon-attach').length).toBeGreaterThan(attachesBefore)
    expect(ledger().filter(e => e.kind === 'daemon-spawn'), 'a reconnect must reattach, never spawn a second daemon').toHaveLength(1)

    // History intact and not duplicated. The replay lands a beat AFTER the banner clears (the
    // readopt repopulates the pane asynchronously) — wait for it, then pin exactly-once.
    await expect(win.locator('.xterm-rows')).toContainText('survive-alpha-3317', { timeout: 15_000 })
    const text = (await win.locator('.xterm-rows').textContent()) ?? ''
    expect(text.split('survive-alpha-3317').length - 1, 'pre-drop output present exactly once').toBe(1)

    // Same session, still answering: the fake backend keeps state per pty, and new input works.
    await win.locator('.xterm-screen').click()
    await win.keyboard.type('echo survive-beta-9421')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('survive-beta-9421', { timeout: 15_000 })
  })
})
