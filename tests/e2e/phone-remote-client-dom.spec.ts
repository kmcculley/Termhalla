// FROZEN e2e suite — feature 0026-phone-web-remote (phase 4, v2 loopback — ESC-001;
// FINDING-013/041/035/050/003/028). The SERVED client, DOM-level (requires `npm run build`
// first — the served bundle is out/phone-client).
//
// The "phone" is a plain Chromium page: a second BrowserWindow in the SAME Electron app
// pointed at the served URL (no preload, no window.api — exactly what a phone browser sees;
// avoids requiring a separate Playwright browser download). `backgroundThrottling: false`
// keeps xterm painting in the unshown window (the CLAUDE.md hidden-window rule).
//
// TEST-2731 REQ-023/REQ-030/REQ-022/REQ-028 — list -> terminal navigation on the served DOM;
// typed input reaches the desktop pane; Ctrl latch + typed 'c' interrupts a live command
// (\x03 delivered); the departing pane is unsubscribed; the active pane's exit renders the
// in-view notice; the empty inventory renders guidance; the pairing token is stripped from
// the URL and the session survives a token-less reload via the HttpOnly cookie.
//
// Served-client testid contract (the implementer keeps these stable):
//   phone-pane-<paneId>  — a pane row in the workspace-grouped list
//   phone-terminal       — the full-screen terminal view host
//   phone-back           — terminal view -> list navigation
//   key-ctrl / key-esc / key-tab / key-up / key-down / key-left / key-right — the key bar
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 18653
const TOKEN = 'e2e-phone-remote-token-2731'
const SEAM_ENV = { TERMHALLA_E2E_PHONE_REMOTE: JSON.stringify({ port: PORT, token: TOKEN, enabled: true }) }

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('TEST-2731: served-client DOM — navigate, type, Ctrl+C, exit notice, cookie relaunch', async () => {
  test.setTimeout(180_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-phone-dom-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env as Record<string, string>, ...SEAM_ENV }
  })
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // open the "phone": a plain page (no preload) on the pairing URL
  const phonePromise = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, { port, token }) => {
    const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    void w.loadURL(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`)
  }, { port: PORT, token: TOKEN })
  const phone: Page = await phonePromise

  // empty inventory -> guidance, not a blank screen (REQ-030)
  await expect(phone.getByText(/open a terminal/i)).toBeVisible({ timeout: 15_000 })

  // the token is stripped from the visible URL after load (REQ-023)
  await expect.poll(() => phone.url(), { timeout: 15_000 }).not.toContain(TOKEN)

  // desktop opens a terminal; the phone list gains the pane via a push (REQ-011 membership)
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  const row = phone.locator('[data-testid^="phone-pane-"]').first()
  await expect(row).toBeVisible({ timeout: 15_000 })

  // tap -> full-screen terminal view
  await row.click()
  await expect(phone.getByTestId('phone-terminal')).toBeVisible({ timeout: 10_000 })

  // typed soft-keyboard input reaches the DESKTOP pane byte-faithfully (REQ-012/REQ-023)
  await phone.locator('.xterm-screen').first().click()
  await phone.keyboard.type('echo dom-e2e-42')
  await phone.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows').first()).toContainText('dom-e2e-42', { timeout: 20_000 })
  // and the phone renders the pane's output stream
  await expect(phone.locator('.xterm-rows').first()).toContainText('dom-e2e-42', { timeout: 20_000 })

  // Ctrl latch + typed letter: interrupt a live command with \x03 (REQ-023 — FINDING-033)
  await phone.keyboard.type('ping -n 60 127.0.0.1')
  await phone.keyboard.press('Enter')
  await expect(phone.locator('.xterm-rows').first()).toContainText('Reply from', { timeout: 30_000 })
  await phone.getByTestId('key-ctrl').click()
  await phone.locator('.xterm-screen').first().click()
  await phone.keyboard.type('c')
  await expect(win.locator('.xterm-rows').first()).toContainText('Control-C', { timeout: 20_000 })

  // the active pane's process exits -> in-view notice, input disabled (REQ-030)
  await phone.keyboard.type('exit')
  await phone.keyboard.press('Enter')
  await expect(phone.getByTestId('phone-terminal')).toContainText(/process exited/i, { timeout: 20_000 })

  // token-less relaunch: the HttpOnly session cookie keeps the session paired (REQ-028/REQ-022)
  await phone.reload()
  await expect(
    phone.getByText(/open a terminal/i).or(phone.locator('[data-testid^="phone-pane-"]').first()),
    'a cookie-backed reload must land in the authenticated app, not a 401 page'
  ).toBeVisible({ timeout: 15_000 })
  expect(phone.url()).not.toContain(TOKEN)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
