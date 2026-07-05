// FROZEN e2e suite — feature 0013-os-needs-you-notifications (phase 4 / DoD acceptance).
// NOT in the `npm test` (vitest) gate — Playwright drives the PACKAGED app under out/ (`npm run build`
// first). Real vectors where reachable: a genuine registry membership change drives a main-side
// needs-you transition; the OS Notification is spied in the MAIN process via the TERMHALLA_E2E_NOTIFY_SPY
// env seam (the TERMHALLA_SAVE_PATH precedent): the composition root's production sinks record each
// would-be toast's {title, body, click} on a main-process global instead of constructing a real desktop
// toast — out/main is ESM, so an app.evaluate cannot patch the static `electron` import binding the
// observer constructs through (`require` doesn't even exist there; the original patch-the-module spy
// never ran). The recorded click callable dispatches the REAL focusMainWindow handoff, so the click →
// drawer-reveal path and the app-wide opt-in are still driven via real IPC / real checkbox toggling.
//
//   TEST-573 — REQ-001/006/007/010: a persisted, PANE-LESS needs-you project fires exactly one OS
//              Notification whose copy names the project + reason (never "done"/"null"); its click
//              brings the app forward and reveals the decision-queue drawer (no matching pane).
//   TEST-574 — REQ-005: with the app-wide opt-in toggled OFF in General settings, the NEXT needs-you
//              transition fires NO Notification — live, without a restart.
//
// Runs RED by construction: the main-process observer, the orkyNotify:focus channel + renderer
// handler, and the app-wide opt-in do not exist yet.
//
// [AMENDED 2026-07-04 — e2e repair]: the original spy did `require('electron')` inside
// app.evaluate; out/main is ESM so `require` is undefined there (and a CJS-module patch could
// never rebind a static import anyway) — BOTH tests had failed on that line since birth (the
// 0013 gate profile ran build+vitest only, never Playwright). The spy now rides the
// TERMHALLA_E2E_NOTIFY_SPY env seam described above; every TEST id, title, and assertion's
// INTENT is unchanged. Also repaired: app-readiness waits before driving pushes/chords into a
// not-yet-mounted renderer, the Ctrl+, settings gesture (the referenced `settings-open` testid
// never existed), a quickSave-debounce race on the opt-in, and pid capture before app.close().
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    // Arm the main-process notification spy seam: the needs-you sinks record {title, body, click}
    // into (globalThis as any).__nyToasts instead of constructing a real OS Notification.
    env: { ...process.env, TERMHALLA_E2E_NOTIFY_SPY: '1' } as Record<string, string>
  })
}

/** A synthetic `.orky/` project whose single feature has an OPEN escalation → needsHuman. */
function seedEscalatedProject(feature = 'demo-feature'): string {
  const proj = mkdtempSync(join(tmpdir(), 'termh-nyproj-'))
  writeEscalation(proj, feature)
  return proj
}
function writeEscalation(proj: string, feature: string): void {
  const fdir = join(proj, '.orky', 'features', feature)
  mkdirSync(fdir, { recursive: true })
  const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
  writeFileSync(join(proj, '.orky', 'active.json'), JSON.stringify({
    feature: `.orky/features/${feature}`, projectRoot: proj, phase: 'implement',
    lastTickAt: new Date().toISOString(), lastAction: 'escalate'
  }), 'utf8')
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({
    feature, phase: 'implement',
    gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
    escalations: [{ id: 'ESC-001', status: 'open', reason: 'pick an option' }]
  }), 'utf8')
  writeFileSync(join(fdir, 'findings.json'), JSON.stringify([]), 'utf8')
}

/** The main-process spy is armed by the TERMHALLA_E2E_NOTIFY_SPY env var at launch (see `launch`
 *  above): the observer's production sinks record every would-be Notification — with a `click`
 *  callable dispatching the real focus handoff — into the main-process global `__nyToasts`, which
 *  plain app.evaluate reads back (only `require`-based module patching was impossible under ESM). */
const readToasts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __nyToasts?: { title: string; body: string }[] }).__nyToasts ?? [])

test('TEST-573 REQ-001 REQ-006 REQ-007 REQ-010 a pane-less needs-you project fires one honest OS notification; its click reveals the drawer', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ny1-'))
  const proj = seedEscalatedProject()
  const app = await launch(userData)
  const win = await app.firstWindow()
  // Readiness: firstWindow resolves before React mounts. The App-level subscription block (which
  // wires the orkyNotify:focus handler this test's click handoff rides) runs after the first
  // commit; the status-bar queue toggle rendering proves that commit happened. Without this, the
  // click's push can fire into a not-yet-subscribed renderer and be silently lost.
  await expect(win.getByTestId('orky-queue-toggle')).toBeVisible({ timeout: 20_000 })

  // Add the project as a PERSISTED (pane-less) root — a genuine membership change → needs-you transition.
  await win.evaluate(async (root) => { await (window as unknown as { termhalla: { registryAddRoot(r: string): Promise<unknown> } }).termhalla.registryAddRoot(root) }, proj)

  await expect.poll(() => readToasts(app), { timeout: 20_000 }).not.toHaveLength(0)
  const toasts = await readToasts(app)
  expect(toasts.length).toBe(1)
  const text = `${toasts[0].title}\n${toasts[0].body}`.toLowerCase()
  expect(text).toContain('escalation')
  expect(text).not.toContain('done')
  expect(text).not.toContain('null')

  // Clicking the notification brings the app forward and reveals the decision-queue drawer (no pane).
  await app.evaluate(() => {
    const t = (globalThis as unknown as { __nyToasts: { click?: () => void }[] }).__nyToasts[0]
    t.click?.()
  })
  await expect(win.getByTestId('decision-queue-panel')).toBeVisible({ timeout: 15_000 })

  // Capture the pid BEFORE close — app.process() on a closed ElectronApplication throws (the
  // sibling suites' teardown idiom).
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-574 REQ-005 with the app-wide opt-in toggled OFF, the next needs-you transition fires no notification (live, no restart)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ny2-'))
  const proj = seedEscalatedProject('feature-one')
  const app = await launch(userData)
  const win = await app.firstWindow()
  // Readiness: the Ctrl+, chord below is handled by App's window-level keydown listener, wired in
  // the App-level effect after the first commit — pressing it before React mounts does nothing.
  await expect(win.getByTestId('orky-queue-toggle')).toBeVisible({ timeout: 20_000 })

  // Toggle the app-wide opt-in OFF in General settings (persists via quickSave → live mirror refresh).
  // Settings opens via the Ctrl+, keybinding (the ⚙ gear was removed — the focus.spec.ts idiom) and
  // lands on the General section, which hosts the checkbox.
  await win.keyboard.press('Control+Comma')
  const optIn = win.getByTestId('orky-needs-you-notifications')
  await optIn.waitFor({ timeout: 15_000 })
  if (await optIn.isChecked()) await optIn.uncheck()
  // The preference rides a DEBOUNCED renderer quickSave; main refreshes its in-memory opt-in mirror
  // inside the SAME quickSave handler that persists quick.json — so once the file on disk carries
  // false, the mirror is off too. Wait for that before driving the transition, or the needs-you
  // push could race the debounce window and fire while still unmuted.
  await expect.poll(() => {
    try { return JSON.parse(readFileSync(join(userData, 'quick.json'), 'utf8')).orkyNeedsYouNotifications }
    catch { return undefined }
  }, { timeout: 15_000 }).toBe(false)

  // A genuine needs-you transition on a NEW feature — the observer must stay inert while muted.
  await win.evaluate(async (root) => { await (window as unknown as { termhalla: { registryAddRoot(r: string): Promise<unknown> } }).termhalla.registryAddRoot(root) }, proj)
  writeEscalation(proj, 'feature-two')

  // Give the aggregate time to re-read; assert the spy stayed empty.
  await win.waitForTimeout(6_000)
  expect(await readToasts(app)).toHaveLength(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
