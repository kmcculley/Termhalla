// FROZEN e2e suite — feature 0013-os-needs-you-notifications (phase 4 / DoD acceptance).
// NOT in the `npm test` (vitest) gate — Playwright drives the PACKAGED app under out/ (`npm run build`
// first). Real vectors where reachable: a genuine registry membership change drives a main-side
// needs-you transition; the OS Notification is spied in the MAIN process (app.evaluate patches the
// electron module's Notification the observer constructs through, so its title/body/click are
// observable without a real desktop toast); the click handoff and the app-wide opt-in are driven via
// real IPC / real checkbox toggling.
//
//   TEST-573 — REQ-001/006/007/010: a persisted, PANE-LESS needs-you project fires exactly one OS
//              Notification whose copy names the project + reason (never "done"/"null"); its click
//              brings the app forward and reveals the decision-queue drawer (no matching pane).
//   TEST-574 — REQ-005: with the app-wide opt-in toggled OFF in General settings, the NEXT needs-you
//              transition fires NO Notification — live, without a restart.
//
// Runs RED by construction: the main-process observer, the orkyNotify:focus channel + renderer
// handler, and the app-wide opt-in do not exist yet.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
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

/** Install a main-process spy over the electron Notification the observer constructs through. */
async function installNotificationSpy(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { __nyToasts: { title: string; body: string; click?: () => void }[] }
    g.__nyToasts = []
    const RealNotification = Notification as unknown as { isSupported(): boolean }
    // Replace the constructor on the shared electron module object the observer reads at call time.
    const electron = require('electron')
    electron.Notification = class {
      _rec: { title: string; body: string; click?: () => void }
      constructor(opts: { title: string; body: string }) {
        this._rec = { title: opts.title, body: opts.body }
        g.__nyToasts.push(this._rec)
      }
      static isSupported() { return RealNotification.isSupported() }
      on(ev: string, cb: () => void) { if (ev === 'click') this._rec.click = cb; return this }
      show() { /* no real toast in the test */ }
      close() {}
    }
  })
}
const readToasts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __nyToasts: { title: string; body: string }[] }).__nyToasts ?? [])

test('TEST-573 REQ-001 REQ-006 REQ-007 REQ-010 a pane-less needs-you project fires one honest OS notification; its click reveals the drawer', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ny1-'))
  const proj = seedEscalatedProject()
  const app = await launch(userData)
  const win = await app.firstWindow()
  await installNotificationSpy(app)

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

  await app.close(); killTree(app.process().pid)
})

test('TEST-574 REQ-005 with the app-wide opt-in toggled OFF, the next needs-you transition fires no notification (live, no restart)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ny2-'))
  const proj = seedEscalatedProject('feature-one')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await installNotificationSpy(app)

  // Toggle the app-wide opt-in OFF in General settings (persists via quickSave → live mirror refresh).
  await win.getByTestId('settings-open').click().catch(() => {})
  const optIn = win.getByTestId('orky-needs-you-notifications')
  await optIn.waitFor({ timeout: 15_000 })
  if (await optIn.isChecked()) await optIn.uncheck()

  // A genuine needs-you transition on a NEW feature — the observer must stay inert while muted.
  await win.evaluate(async (root) => { await (window as unknown as { termhalla: { registryAddRoot(r: string): Promise<unknown> } }).termhalla.registryAddRoot(root) }, proj)
  writeEscalation(proj, 'feature-two')

  // Give the aggregate time to re-read; assert the spy stayed empty.
  await win.waitForTimeout(6_000)
  expect(await readToasts(app)).toHaveLength(0)

  await app.close(); killTree(app.process().pid)
})
