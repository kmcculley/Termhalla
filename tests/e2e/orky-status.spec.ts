// FROZEN e2e suite — feature 0004-orky-status-awareness (phase 4 / DoD acceptance).
// Fixtures a synthetic `.orky/` tree under a temp project, points a real terminal pane's cwd at it,
// and asserts the toolbar Orky chip + label, the pane-border precedence over byte-status, the workspace
// tab-badge roll-up, the detail popover, and clean teardown when the cwd leaves the `.orky/` project.
//
// Mirrors the launch/cwd pattern of tests/e2e/usage.spec.ts + tests/e2e/status.spec.ts. Runs against
// out/ — `npm run build` is required first. RED by construction until implemented: the orky-chip /
// orky-menu test-ids and the Orky-derived border do not exist yet, so these assertions time out.
//
// The fixture feature sits in the `human-review` phase (needsHuman) with 7 passed gates and 0 open
// findings → chip label `demo-feature · human-review · 7/8`, a needs-input border, and a tab 🔔. The
// shell never emits a y/N prompt, so byte-status can never be needs-input on its own — observing a
// needs-input border therefore PROVES the Orky status took precedence (REQ-014).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

/** Write a synthetic `.orky/` project with a single feature parked in human-review (needs a human). */
function seedOrkyProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'termh-orkyproj-'))
  const orky = join(proj, '.orky')
  const fdir = join(orky, 'features', 'demo-feature')
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(orky, 'active.json'), JSON.stringify({
    feature: '.orky/features/demo-feature', projectRoot: proj, phase: 'human-review',
    lastTickAt: new Date().toISOString(), lastAction: 'await:human'
  }), 'utf8')
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({
    feature: 'demo-feature', phase: 'human-review',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed(), implement: passed(), review: passed(), 'doc-sync': passed() },
    escalations: []
  }), 'utf8')
  writeFileSync(join(fdir, 'findings.json'), JSON.stringify([]), 'utf8')
  return proj
}

async function openTerminalAt(win: Awaited<ReturnType<ElectronApplication['firstWindow']>>, dir: string): Promise<void> {
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${dir}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(dir)}"]`)).toHaveCount(1, { timeout: 15_000 })
}

test('binds an Orky run: chip label, border precedence, tab badge, and popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-orky-'))
  const proj = seedOrkyProject()

  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await openTerminalAt(win, proj)

  // TEST-033 REQ-012 — the pane auto-binds and the toolbar Orky chip appears.
  const chip = win.locator('[data-testid^="orky-chip-"]').first()
  await expect(chip).toBeVisible({ timeout: 20_000 })

  // TEST-034 REQ-008 — the chip renders `feature · phase · gate N/M · ●k open` (7 of 8 gates passed).
  await expect(chip).toContainText('demo-feature')
  await expect(chip).toContainText('human-review')
  await expect(chip).toContainText('7/8')

  // TEST-035 REQ-014/REQ-016 — Orky needsHuman drives a needs-input border (byte-status is idle here,
  // so this border can only come from the Orky precedence). The complementary shell/proc chip stays.
  await expect(win.locator('[data-status="needs-input"]')).toHaveCount(1, { timeout: 20_000 })

  // TEST-036 REQ-009 — the workspace tab lights its needs-you badge.
  await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('🔔', { timeout: 10_000 })

  // TEST-038 REQ-020 — the chip opens a body-portalled popover listing the non-Idle feature(s).
  await chip.click()
  const popover = win.locator('[data-testid="orky-menu"]')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await expect(popover).toContainText('demo-feature')

  // REQ-017 — read-only: the fixtured state.json is untouched by the watch session.
  const stPath = join(proj, '.orky', 'features', 'demo-feature', 'state.json')
  const mtimeBefore = statSync(stPath).mtimeMs
  const contentBefore = readFileSync(stPath, 'utf8')
  await win.waitForTimeout(500)
  expect(statSync(stPath).mtimeMs).toBe(mtimeBefore)
  expect(readFileSync(stPath, 'utf8')).toBe(contentBefore)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('clears the Orky chrome when the pane cwd leaves the .orky/ project (teardown)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-orky2-'))
  const proj = seedOrkyProject()
  const elsewhere = mkdtempSync(join(tmpdir(), 'termh-noorky-')) // no .orky here

  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await openTerminalAt(win, proj)
  await expect(win.locator('[data-testid^="orky-chip-"]').first()).toBeVisible({ timeout: 20_000 })

  // TEST-037 REQ-012 — leaving the .orky/ project clears the chip and reverts the border to byte-status.
  await win.keyboard.type(`Set-Location '${elsewhere}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(elsewhere)}"]`)).toHaveCount(1, { timeout: 15_000 })
  await expect(win.locator('[data-testid^="orky-chip-"]')).toHaveCount(0, { timeout: 20_000 })
  await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 15_000 }) // reverted to byte-derived status

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
