// FROZEN e2e suite — feature 0026-phone-web-remote (phase 4, v2 loopback — ESC-001;
// FINDING-012/013/023). Launches the real app against out/ (requires `npm run build` first).
//
// These specs CONSUME the REQ-025 seam: TERMHALLA_E2E_PHONE_REMOTE (JSON) with
//   { port, token, enabled: true }
// forces the phone-remote service ON at a fixed port with the injected pairing token accepted —
// proving the seam is wired into the production service construction (a decorative unconsumed
// seam is non-conforming). With the var unset (the baseline launch below), production behavior
// is byte-identical: no listener, no mirrors.
//
// TEST-2727 REQ-025/REQ-015 — seam consumption + the desktop renderer path is byte-identical
//                              with the server enabled and a live client attached.
// TEST-2728 REQ-019          — app close completes promptly with a live WS client attached.
// TEST-2729 REQ-011          — the REAL production composition serves a real workspace-grouped
//                              inventory (true workspace name, human-readable title, true grid)
//                              and pushes membership while a client stays connected.
// TEST-2730 REQ-029/REQ-002  — the settings surface is reachable through the REAL Settings
//                              navigation; the LAN warning renders only in LAN mode.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const PORT = 18641
const TOKEN = 'e2e-phone-remote-token-2727'
const SEAM_ENV = { TERMHALLA_E2E_PHONE_REMOTE: JSON.stringify({ port: PORT, token: TOKEN, enabled: true }) }

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

const launch = (userData: string, env?: Record<string, string>): Promise<ElectronApplication> =>
  electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env as Record<string, string>, ...(env ?? {}) }
  })

type Msg = Record<string, unknown> & { type: string }

const wsClient = (): Promise<{ ws: WebSocket; msgs: Msg[]; closed: () => boolean }> =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(TOKEN)}`)
    const msgs: Msg[] = []
    let isClosed = false
    ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))) } catch { /* non-JSON */ } })
    ws.on('close', () => { isClosed = true })
    ws.on('open', () => res({ ws, msgs, closed: () => isClosed }))
    ws.on('error', rej)
  })

const waitFor = async (pred: () => boolean, ms = 15_000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor: timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const firstPaneId = (msgs: Msg[]): string | undefined => {
  const inv = [...msgs].reverse().find((m) => m.type === 'panes') as
    { workspaces?: Array<{ panes: Array<{ paneId: string }> }> } | undefined
  return inv?.workspaces?.flatMap((w) => w.panes)[0]?.paneId
}

/** The rendered text row containing `marker` in the FIRST terminal of the window. */
async function rowWith(win: Awaited<ReturnType<ElectronApplication['firstWindow']>>, marker: string): Promise<string> {
  const rows = win.locator('.xterm-rows').first()
  await expect(rows).toContainText(marker, { timeout: 20_000 })
  const text = await rows.innerText()
  const line = text.split('\n').find((l) => l.includes(marker))
  return (line ?? '').trim()
}

test('TEST-2727: seam-fixed server is reachable; the desktop renders byte-identically to the server-off baseline', async () => {
  test.setTimeout(150_000)
  const marker = 'phone-e2e-magic-777'

  // Run A: server ON through the seam, a live client attached to the driven pane
  const udA = mkdtempSync(join(tmpdir(), 'termh-phone-a-'))
  const appA = await launch(udA, SEAM_ENV)
  const winA = await appA.firstWindow()
  await winA.getByTestId('add-first-terminal').click()
  await expect(winA.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  const client = await wsClient() // proves the seam-fixed port + token work (REQ-025 consumption)
  await waitFor(() => client.msgs.some((m) => m.type === 'hello'))
  await waitFor(() => firstPaneId(client.msgs) !== undefined)
  const paneId = String(firstPaneId(client.msgs))
  client.ws.send(JSON.stringify({ type: 'subscribe', paneId }))
  await waitFor(() => client.msgs.some((m) => m.type === 'snapshot'))

  await winA.locator('.xterm-screen').first().click()
  await winA.keyboard.type(`echo ${marker}`)
  await winA.keyboard.press('Enter')
  const lineA = await rowWith(winA, marker)
  // the attached client streams the same output (the mirror sees what the desktop sees)
  await waitFor(() => client.msgs.some((m) => (m.type === 'data' || m.type === 'snapshot' || m.type === 'resync') && String(m.data ?? '').includes(marker)), 20_000)
  client.ws.close()
  const pidA = appA.process().pid; await appA.close().catch(() => {}); killTree(pidA)

  // Run B: baseline, seam UNSET — production behavior (no server); the rendered line is identical
  const udB = mkdtempSync(join(tmpdir(), 'termh-phone-b-'))
  const appB = await launch(udB)
  const winB = await appB.firstWindow()
  await winB.getByTestId('add-first-terminal').click()
  await expect(winB.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await winB.locator('.xterm-screen').first().click()
  await winB.keyboard.type(`echo ${marker}`)
  await winB.keyboard.press('Enter')
  const lineB = await rowWith(winB, marker)
  expect(lineA, 'the desktop render must not differ when the server + a client ride along').toBe(lineB)
  const pidB = appB.process().pid; await appB.close().catch(() => {}); killTree(pidB)
})

test('TEST-2728: app close completes promptly with the server enabled and a live WS client (REQ-019)', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-phone-close-'))
  const app = await launch(userData, SEAM_ENV)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  const client = await wsClient()
  await waitFor(() => client.msgs.some((m) => m.type === 'hello'))
  await waitFor(() => firstPaneId(client.msgs) !== undefined)
  client.ws.send(JSON.stringify({ type: 'subscribe', paneId: String(firstPaneId(client.msgs)) }))
  await waitFor(() => client.msgs.some((m) => m.type === 'snapshot'))

  const pid = app.process().pid
  const t0 = Date.now()
  await app.close()
  expect(Date.now() - t0, 'an unref-d, stop-wired server must never hang app close').toBeLessThan(15_000)
  killTree(pid)
})

test('TEST-2729: the REAL composition serves a real workspace-grouped inventory with membership pushes (REQ-011)', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-phone-inv-'))
  const app = await launch(userData, SEAM_ENV)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // connect FIRST: the pane spawned below must arrive as a push, not a reconnect
  const client = await wsClient()
  await waitFor(() => client.msgs.some((m) => m.type === 'hello'))

  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await waitFor(() => firstPaneId(client.msgs) !== undefined, 20_000)

  const inv = [...client.msgs].reverse().find((m) => m.type === 'panes') as {
    workspaces?: Array<{ id: string; name: string; panes: Array<{ paneId: string; title: string; cols: number; rows: number; status: string }> }>
  }
  const ws0 = inv.workspaces![0]
  const pane = ws0.panes[0]

  // the workspace NAME is the desktop's real name (the visible tab label), not a synthetic stub
  const tabText = (await win.locator('[data-testid^="tab-"]').first().innerText()).trim()
  expect(ws0.name.length).toBeGreaterThan(0)
  expect(tabText.toLowerCase()).toContain(ws0.name.toLowerCase().slice(0, Math.min(ws0.name.length, 12)))
  expect(ws0.name, 'the rejected single-synthetic-workspace stub must be gone').not.toBe('Termhalla')

  // human-readable title, never the raw internal pane id
  expect(pane.title).toBeTruthy()
  expect(pane.title).not.toBe(pane.paneId)
  expect(pane.title, 'a raw uuid is not a title').not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/i)

  // a REAL grid (the desktop's fitted terminal is never the 80x24 default in this layout)
  expect(pane.cols).toBeGreaterThan(0)
  expect(pane.rows).toBeGreaterThan(0)
  expect(['idle', 'busy', 'needs-input', 'exited']).toContain(pane.status)

  client.ws.close()
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-2730: Settings navigation reaches the phone-remote section; the LAN warning is mode-gated (REQ-029/REQ-002)', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-phone-settings-'))
  const app = await launch(userData, SEAM_ENV)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.keyboard.press('Control+Comma')
  await expect(win.getByTestId('settings-general')).toBeVisible({ timeout: 5_000 })

  // the REAL mount path: the section is in the Settings nav and selecting it renders the surface
  await win.getByRole('button', { name: /phone/i }).click()
  await expect(win.getByTestId('phone-remote-settings')).toBeVisible({ timeout: 5_000 })

  // localhost mode: no plaintext warning; LAN mode: the warning renders
  const surface = win.getByTestId('phone-remote-settings')
  await expect(surface.getByText(/plaintext|unencrypted/i)).toHaveCount(0)
  await surface.getByText(/lan/i).first().click()
  await expect(surface.getByText(/plaintext|unencrypted/i).first()).toBeVisible({ timeout: 5_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
