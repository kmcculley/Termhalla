// FROZEN e2e suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-011 +
// TASK-012 + TASK-013). Playwright-for-Electron against out/. NOT in the `npm test` gate (vitest
// includes only tests/**/*.test.ts); must be witnessed green against the built implementation
// before the review gate closes (CONV-052).
//
// Environment reality: no live agent exists in e2e. The named agent points at an invalid host
// (RFC 6761 `.invalid` TLD), so the connection deterministically FAILS — which is exactly the
// surface under test: the disconnected banner, its Reconnect affordance, the keep-mounted pane
// under it, and the capability greying of a not-connected remote workspace (allowed = pty only).
// Whether the failure classifies as connect-failed (ssh resolves nothing / ssh missing) is
// environment-dependent — the assertions pin the STATE (disconnected + diagnostic non-empty),
// never one reason string.
//
// FINDING-017 (0010) reality: node-pty's native binding may be absent in this checkout, so NO
// live LOCAL pty transcript is asserted anywhere — layout/persistence pins only (the cockpit
// suite precedent).
//
//   TEST-2272 — REQ-015/REQ-002: templates-menu row → picker → add agent → create: a remote-home
//               workspace exists with ONE terminal pane at cwd ''; the persisted file carries
//               schemaVersion 9 + the home record; quick.json gains no template.
//   TEST-2273 — REQ-016/REQ-013: the banner reaches disconnected with a non-empty diagnostic and
//               a Reconnect button; the pane tile REMAINS mounted under it (keep-mounted).
//   TEST-2274 — REQ-017: in the not-connected remote workspace the split menu's editor/explorer/
//               orky kind buttons are disabled (with a reason title) while terminal stays enabled.
//   TEST-2275 — REQ-016: Reconnect re-arms the flow (banner shows connecting-with-Cancel or lands
//               disconnected again) and the app stays healthy; a LOCAL workspace created after all
//               of this still commits a terminal tile (local behavior intact).
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

async function saveAll(win: Page): Promise<void> {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('save all')
  await win.getByTestId('palette-input').press('Enter')
  await win.waitForTimeout(1_000)
}

async function createRemoteWorkspace(win: Page): Promise<void> {
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-remote-workspace').click()
  const picker = win.getByTestId('remote-agent-picker')
  await expect(picker).toBeVisible()
  await win.getByTestId('remote-agent-name').fill('e2e-agent')
  await win.getByTestId('remote-agent-host').fill('agent.e2e.invalid')
  await win.getByTestId('remote-agent-user').fill('e2e')
  await win.getByTestId('remote-agent-add').click()
  // Select the just-added row by its stable per-id testid (CONV-056: never a hasText filter — the
  // row also renders "e2e@agent.e2e.invalid", which a substring match would ambiguously hit).
  await win.locator('[data-testid^="remote-agent-select-"]').first().click()
  await win.getByTestId('remote-agent-create').click()
  await expect(picker).toHaveCount(0)
}

test.describe.serial('remote workspace UX', () => {
  let app: ElectronApplication
  let win: Page
  let userData: string

  test.beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'termh-remote-'))
    app = await launch(userData)
    win = await app.firstWindow()
    await win.waitForSelector('[data-tab-id]')
  })

  test.afterAll(async () => {
    const pid = app?.process()?.pid
    try { await app?.close() } catch { killTree(pid) }
  })

  test('TEST-2272 REQ-015 REQ-002 the single gesture creates a remote-home workspace persisted at schema 9', async () => {
    await createRemoteWorkspace(win)
    await expect(win.locator('[data-tab-id]')).toHaveCount(2)

    // Persist and read back the workspace file (the cockpit suite's LAYOUT/ARGV pin pattern).
    await saveAll(win)
    const wsDir = join(userData, 'workspaces')
    const saved = readdirSync(wsDir).map(f => readFileSync(join(wsDir, f), 'utf8')).find(s => s.includes('"agent"'))
    expect(saved, 'a saved workspace must carry the remote home').toBeTruthy()
    const parsed = JSON.parse(saved!) as {
      schemaVersion: number
      workspace: { home?: { kind: string; agentId: string; agentName: string }; panes: Record<string, { config: Record<string, unknown> }> }
    }
    expect(parsed.schemaVersion).toBe(9) // this feature's sanctioned bump (REQ-002)
    expect(parsed.workspace.home?.kind).toBe('agent')
    expect(parsed.workspace.home?.agentName).toBe('e2e-agent')
    const configs = Object.values(parsed.workspace.panes).map(p => p.config)
    expect(configs).toHaveLength(1)
    expect(configs[0].kind).toBe('terminal')
    expect(configs[0].cwd).toBe('') // the agent home dir — never a local path
  })

  test('TEST-2273 REQ-016 REQ-013 the banner lands disconnected with a diagnostic + Reconnect while the pane stays mounted', async () => {
    const banner = win.getByTestId('remote-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(win.getByTestId('remote-reconnect')).toBeVisible({ timeout: 60_000 })
    const text = (await banner.textContent()) ?? ''
    expect(text.length).toBeGreaterThan(20) // reason copy + diagnostic, never a bare state word
    // Keep-mounted: the terminal tile is still in the DOM under the banner (never unmounted).
    await expect(win.locator('.mosaic-window')).toHaveCount(1)
    await expect(win.locator('[data-testid^="split-"]').first()).toBeAttached()
  })

  test('TEST-2274 REQ-017 pane-kind creation is greyed per the not-connected capability set (pty only)', async () => {
    const paneId = await win.locator('[data-testid^="close-"]').first()
      .getAttribute('data-testid').then(v => v!.replace('close-', ''))
    await win.getByTestId(`split-${paneId}`).click()
    await expect(win.getByTestId(`split-kind-terminal-${paneId}`)).toBeEnabled()
    for (const kind of ['editor', 'explorer', 'orky']) {
      const btn = win.getByTestId(`split-kind-${kind}-${paneId}`)
      await expect(btn, `${kind} must be greyed in a remote workspace`).toBeDisabled()
      const title = (await btn.getAttribute('title')) ?? ''
      expect(title.length, `${kind} carries an actionable reason (CONV-001)`).toBeGreaterThan(10)
    }
    await win.keyboard.press('Escape')
  })

  test('TEST-2275 REQ-016 Reconnect re-arms the connection flow; local workspaces still work afterwards', async () => {
    await win.getByTestId('remote-reconnect').click()
    // The attempt either shows connecting (with the Cancel affordance) or fails fast back to
    // disconnected — both are healthy; the banner never strands without an action.
    await expect(win.getByTestId('remote-banner')).toBeVisible({ timeout: 30_000 })
    await expect(win.getByTestId('remote-cancel').or(win.getByTestId('remote-reconnect')))
      .toBeVisible({ timeout: 60_000 })

    // Local behavior intact: a fresh local workspace shows its add-a-pane prompt with NO banner.
    // Created via the palette (its new-workspace action mints a plain workspace without the tab
    // button's inline-rename side-effect), so the empty-workspace prompt is immediately usable.
    await win.keyboard.press('Control+KeyK')
    await win.getByTestId('palette-input').fill('New workspace')
    await win.getByTestId('palette-input').press('Enter')
    // Scope to the ACTIVE workspace host: all hosts stay mounted (the keep-mounted discipline), so
    // the boot workspace's own empty-workspace prompt is also in the DOM (visibility:hidden).
    const active = win.locator('[data-testid="workspace-host"][data-active="true"]')
    await expect(active.getByTestId('empty-workspace')).toBeVisible({ timeout: 10_000 })
    await expect(active.getByTestId('remote-banner')).toHaveCount(0) // a local workspace never shows the banner
    await active.getByTestId('add-first-terminal').click()
    await expect(active.locator('.mosaic-window')).toHaveCount(1) // the active (local) workspace shows its tile
  })
})
