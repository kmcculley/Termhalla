// LOOPBACK e2e — feature 0011-orky-workspace-template (review → tests loopback per ESC-001,
// 2026-07-03). Playwright-for-Electron against out/. NOT in the `npm test` gate; witnessed per
// CONV-052 alongside the frozen orky-cockpit.spec.ts suite.
//
//   TEST-683 — REQ-003/REQ-005 (FINDING-007): BOTH picker-mediated cockpit gestures (palette →
//              picker → pick, and the templates-menu built-in row → picker → pick) must leave
//              keyboard focus on a SANE target — an element of the app, ideally in the new
//              cockpit — never stranded on <body>, where a keyboard user's next keystrokes are
//              silently swallowed (the QOL-002 class this codebase repeatedly repaired;
//              commitPane/setActive land focus, and CONV-046 sanctions gesture-mounted focus).
//              RED against the current build: the invoking chrome (palette / templates menu)
//              unmounts in the SAME batched commit that mounts the F11 picker, so the picker's
//              CONV-020 useOpenFocusRestore captures <body> as the opener and the close-restore
//              lands there. The queue-button path is unaffected (its button stays mounted) and
//              is deliberately not pinned. No live pty is needed: focus is observed on
//              document.activeElement, not inside a spawned terminal.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}
type Win = Awaited<ReturnType<ElectronApplication['firstWindow']>>

/** The orky-cockpit.spec fixture: one needs-human feature + one clean-done feature. */
function seedOrkyProject(prefix: string): string {
  const proj = mkdtempSync(join(tmpdir(), prefix))
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  const escDir = join(proj, '.orky', 'features', 'esc-feature')
  mkdirSync(escDir, { recursive: true })
  writeFileSync(join(escDir, 'state.json'), JSON.stringify({
    feature: 'esc-feature', phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [{ id: 'ESC-001', status: 'open', reason: 'pick an option', at: '2026-06-30T01:00:00.000Z' }]
  }), 'utf8')
  writeFileSync(join(escDir, 'findings.json'), JSON.stringify([]), 'utf8')
  const doneDir = join(proj, '.orky', 'features', 'done-feature')
  mkdirSync(doneDir, { recursive: true })
  writeFileSync(join(doneDir, 'state.json'), JSON.stringify({
    feature: 'done-feature', phase: 'doc-sync',
    gates: {
      brainstorm: passed(), spec: passed(), plan: passed(), tests: passed(),
      implement: passed(), review: passed(), 'doc-sync': passed(), 'human-review': passed()
    },
    escalations: []
  }), 'utf8')
  writeFileSync(join(doneDir, 'findings.json'), JSON.stringify([]), 'utf8')
  return proj
}
function seedRegistry(userData: string, roots: string[]): void {
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
}
async function expectCockpit(win: Win, proj: string): Promise<void> {
  const activeHost = win.locator('[data-testid="workspace-host"][data-active="true"]')
  await expect(activeHost.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 20_000 })
  await expect(activeHost.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 20_000 })
  await expect(activeHost.locator('[data-testid^="tile-"]')).toHaveCount(2)
}
/** The FINDING-007 observable: after the gesture completes, document.activeElement is a real
 *  element of the app — never <body>/<html>/null. Polled: a focus request may legitimately land
 *  over the next frames (the registry's retry window covers a pane still committing its mount). */
async function expectFocusNotStranded(win: Win, gesture: string): Promise<void> {
  await expect
    .poll(
      () => win.evaluate(() => {
        const el = document.activeElement
        if (el === null || el === document.body || el === document.documentElement) return 'STRANDED'
        const tid = el.getAttribute('data-testid')
        return `${el.tagName.toLowerCase()}${tid ? `[data-testid=${tid}]` : ''}`
      }),
      {
        message: `${gesture}: keyboard focus must land on a SANE target (the new cockpit's pane / a stable element) — FINDING-007: the CONV-020 restore collapses onto <body> because the invoking chrome unmounted together with the picker's open, so the next keystrokes are silently swallowed`,
        timeout: 5_000
      }
    )
    .not.toBe('STRANDED')
}

test('TEST-683 REQ-003 REQ-005 (FINDING-007) both picker-mediated cockpit gestures (palette → pick, templates-menu row → pick) leave keyboard focus on a sane target — never stranded on <body>', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ckf-'))
  const proj = seedOrkyProject('termh-cockpit-focus-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // gesture 1: palette → relabelled picker → pick (keyboard end-to-end)
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('cockpit')
  await expect(win.getByTestId('palette-item-0')).toContainText(/Orky project workspace/, { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expectCockpit(win, proj)
  await expectFocusNotStranded(win, 'palette gesture')

  // gesture 2: the templates-menu built-in row → picker → pick
  await win.getByTestId('templates-button').click()
  await expect(win.getByTestId('templates-menu')).toBeVisible()
  await win.getByTestId('tpl-orky-cockpit').click()
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expectCockpit(win, proj)
  await expectFocusNotStranded(win, 'templates-menu row gesture')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
