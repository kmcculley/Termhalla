// FROZEN e2e suite — feature 0006-decision-queue-panel (phase 4 / DoD acceptance).
// Runs against out/ (`npm run build` first), in the PACKAGED renderer — where the main world is
// contextIsolated and `process` is undefined, which is exactly the trap REQ-009's fold-mode source
// must survive (test-green/runtime-broken guard). Fixtures a synthetic `.orky/` project whose one
// feature carries an OPEN ESCALATION (needsHuman) so it is a queue member.
//
//   TEST-365 — REQ-001/002/007/011/012: status-bar toggle + rebindable chord, live badge with the
//              drawer CLOSED, drawer renders outside every .mosaic subtree, empty vs list states.
//   TEST-366 — REQ-009: clicking a queue item's BODY focuses the matching pane in the real
//              renderer (`process` undefined in the main world — the fold mode must come from
//              navigator). AMENDED 2026-07-02 by feature 0008-queue-answer-resume-actions
//              (REQ-013/REQ-015, CONV-019): the row now hosts a nested, pointer-ISOLATED actions
//              region, so Playwright's default CENTER-point click became layout-dependent — the
//              click now targets the row's top-left body padding explicitly. The pinned intent
//              (a row-BODY click focuses the pane, exactly once) is unchanged; the complementary
//              half (a click INSIDE the actions region must NOT focus the pane) is pinned by
//              tests/e2e/orky-queue-actions.spec.ts TEST-610.
//   TEST-367 — REQ-010/017: a persisted, pane-less project shows "open terminal here", activating it
//              spawns a terminal at the project ROOT with zero workspaces present; the fixtured
//              `.orky/` tree is byte-identical afterwards; a relaunch starts with the drawer closed.
//   TEST-372 — REQ-014/010 (review loopback ESC-001 / FINDING-008 — sanctioned extension): the
//              pane-less fallback is reachable by Tab and ACTIVATABLE by Enter — the keyboard path
//              the frozen suite only exercised via .click(), which let a preventDefault()ed
//              silent no-op ship green.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

/** A synthetic `.orky/` project whose single feature has an OPEN escalation → needsHuman → queue member. */
function seedEscalatedProject(prefix = 'termh-dqproj-'): string {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const fdir = join(proj, '.orky', 'features', 'demo-feature')
  mkdirSync(fdir, { recursive: true })
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  writeFileSync(join(proj, '.orky', 'active.json'), JSON.stringify({
    feature: '.orky/features/demo-feature', projectRoot: proj, phase: 'implement',
    lastTickAt: new Date().toISOString(), lastAction: 'escalate'
  }), 'utf8')
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({
    feature: 'demo-feature', phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [{ id: 'ESC-001', status: 'open', reason: 'pick an option' }]
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

test('TEST-365 REQ-001 REQ-002 REQ-007 REQ-011 REQ-012 toggle surfaces, live badge while closed, drawer outside the mosaic', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-dq1-'))
  const proj = seedEscalatedProject()
  const app = await launch(userData)
  const win = await app.firstWindow()
  await openTerminalAt(win, proj)

  // REQ-007: the badge is LIVE while the drawer is closed (the subscription is app-level).
  const toggle = win.getByTestId('orky-queue-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).toContainText('1', { timeout: 20_000 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // REQ-002a: the status-bar affordance opens the drawer; REQ-014: aria-expanded tracks it.
  await toggle.click()
  const panel = win.getByTestId('decision-queue-panel')
  await expect(panel).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // REQ-001: window chrome, OUTSIDE every .mosaic/workspace-host subtree.
  await expect(win.locator('.mosaic-blueprint-theme [data-testid="decision-queue-panel"]')).toHaveCount(0)
  await expect(win.locator('[data-testid="workspace-host"] [data-testid="decision-queue-panel"]')).toHaveCount(0)

  // The queue lists the escalated feature with its stable (root, feature) identity (REQ-015).
  const item = win.locator('[data-testid="decision-queue-item"]')
  await expect(item).toHaveCount(1, { timeout: 20_000 })
  await expect(item).toHaveAttribute('data-feature', 'demo-feature')
  await expect(item).toContainText('demo-feature')

  // REQ-002c: the default rebindable chord toggles the drawer closed (and unmounts it, REQ-001).
  await win.keyboard.press('Control+Shift+O')
  await expect(win.locator('[data-testid="decision-queue-panel"]')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-366 REQ-009 clicking a queue item BODY focuses the matching pane in the packaged renderer (process is undefined there; body-click amended by feature 0008 — CONV-019)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-dq2-'))
  const proj = seedEscalatedProject()
  const app = await launch(userData)
  const win = await app.firstWindow()
  await openTerminalAt(win, proj)

  // Guard the trap explicitly: the renderer main world has NO `process` global (vitest does).
  expect(await win.evaluate(() => typeof (globalThis as Record<string, unknown>).process)).toBe('undefined')

  await win.getByTestId('orky-queue-toggle').click()
  const item = win.locator('[data-testid="decision-queue-item"]')
  await expect(item).toHaveCount(1, { timeout: 20_000 })

  // Move focus away from the terminal, then a ROW-BODY click must bring it back to the matched
  // pane. Click the top-left body padding EXPLICITLY (feature 0008 amendment, CONV-019): the
  // default center-point click could land inside the row's 0008 actions region, whose pointer
  // isolation (0008 REQ-015) deliberately does NOT fire the row's focus-project gesture.
  await item.click({ position: { x: 12, y: 10 } })
  await expect(win.locator('textarea.xterm-helper-textarea')).toBeFocused({ timeout: 10_000 })
  // The matched pane's project has an open pane → its item shows NO fallback affordance (REQ-010).
  await expect(win.locator('[data-testid="decision-queue-open-terminal"]')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-367 REQ-010 REQ-017 pane-less fallback spawns a terminal at the project root; .orky stays byte-identical; drawer starts closed on relaunch', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-dq3-'))
  const proj = seedEscalatedProject('termh-dqpersist-')
  // Seed the PERSISTED registry list (F5's orky-registry.json under userData): a pane-less member.
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots: [proj] }), 'utf8')
  const stPath = join(proj, '.orky', 'features', 'demo-feature', 'state.json')
  const contentBefore = readFileSync(stPath, 'utf8')
  const mtimeBefore = statSync(stPath).mtimeMs

  const app = await launch(userData)
  const win = await app.firstWindow()

  // No pane was ever opened (zero workspaces) — the persisted project still queues (REQ-004) and,
  // having no matching pane in this window, its item exposes the fallback affordance (REQ-010).
  await win.getByTestId('orky-queue-toggle').click()
  const fallback = win.locator('[data-testid="decision-queue-open-terminal"]')
  await expect(fallback).toHaveCount(1, { timeout: 20_000 })
  await expect(fallback).toHaveAttribute('data-project-root', proj)

  // Activating it creates a workspace (none existed) and commits a terminal whose cwd is the ROOT.
  await fallback.click()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(proj)}"]`)).toHaveCount(1, { timeout: 20_000 })

  // REQ-017: the whole interaction session left the fixtured .orky/ tree byte-identical.
  await win.waitForTimeout(500)
  expect(readFileSync(stPath, 'utf8')).toBe(contentBefore)
  expect(statSync(stPath).mtimeMs).toBe(mtimeBefore)

  const pid1 = app.process().pid; await app.close().catch(() => {}); killTree(pid1)

  // REQ-017: nothing persisted the drawer state — a relaunch starts with the drawer CLOSED.
  const app2 = await launch(userData)
  const win2 = await app2.firstWindow()
  await expect(win2.getByTestId('orky-queue-toggle')).toBeVisible({ timeout: 20_000 })
  await expect(win2.locator('[data-testid="decision-queue-panel"]')).toHaveCount(0)
  const pid2 = app2.process().pid; await app2.close().catch(() => {}); killTree(pid2)
})

test('TEST-372 REQ-014 REQ-010 keyboard-only path: Tab reaches the pane-less fallback and Enter activates it (review loopback, FINDING-008)', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-dq4-'))
  const proj = seedEscalatedProject('termh-dqkbd-')
  // A persisted, pane-less member — the exact shape whose fallback TEST-367 activates by MOUSE only.
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots: [proj] }), 'utf8')

  const app = await launch(userData)
  const win = await app.firstWindow()

  const toggle = win.getByTestId('orky-queue-toggle')
  await toggle.click()
  const fallback = win.locator('[data-testid="decision-queue-open-terminal"]')
  await expect(fallback).toHaveCount(1, { timeout: 20_000 })

  // Keyboard-ONLY from here (REQ-014): starting from the toggle, Tab must REACH the fallback
  // button itself (AT exposure — a Children-Presentational wrapper would not stop Tab, but the
  // activation below would then be swallowed; both halves are pinned).
  await toggle.focus()
  let reached = false
  for (let i = 0; i < 25 && !reached; i++) {
    await win.keyboard.press('Tab')
    reached = await win.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.dataset?.testid === 'decision-queue-open-terminal')
  }
  expect(reached, 'Tab must reach the pane-less fallback button').toBe(true)

  // Enter must ACTIVATE the fallback: a terminal pane spawns at the project ROOT — never a
  // preventDefault()ed silent no-op on the bubbled row keydown (REQ-010 / FINDING-008).
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(proj)}"]`)).toHaveCount(1, { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
