// FROZEN e2e suite — feature 0012-quick-capture-inbox (phase 4; REVISION 2 — ESC-001 loopback).
// Playwright-for-Electron against out/ (`npm run build` first). Covers what the node harness cannot
// reach (the 0009 "Testability constraint" + the F6 TEST-372 loopback lesson: activation is proven
// with REAL key presses, never only .click()).
//
// StrictMode note (corrected per REQ-006/REQ-012 rev-2, FINDING-018): this suite drives the PRODUCTION
// bundle under out/, where React's StrictMode double mount/effect invocation is compiled out / inert.
// The dispatch counts here therefore measure the REAL shipped lifecycle (zero on open/mount, exactly
// one per gesture, zero on cancel/Escape) but NOT StrictMode semantics — no shipped harness runs
// React's development build. The StrictMode double-dispatch class is guarded STRUCTURALLY by
// TEST-489 (the api.orkySubmitWork call lives in an event handler, never a useEffect callback); this
// suite must never be cited as exercising StrictMode.
//
// The dispatch chain is REAL end-to-end: chord → modal → api.orkySubmitWork → preload → registrar →
// OrkyActionDispatcher → runOrkyCli(process.execPath, [cli.js, 'submit', …]) → a STUB Orky feedback
// CLI seeded into ORKY_PLUGIN_DIR/feedback/cli.js. The stub appends its received argv (from the
// 'submit' element on) to argv-log.jsonl — the byte-verbatim proof surface — and answers per a
// sibling mode.json across the FULL result universe (FINDING-002/FINDING-014): file-mode receipt
// (exit 0), disabled refusal (exit 1 + {ok:false, mode:'noop'}), http refusal (exit 1 +
// {ok:false, mode:'http'}), generic internal error (exit 2 + {error}), and a delayMs knob that both
// drives the single-flight race and (delayMs > the 15s runner timeout) triggers a genuine
// cli-timeout. No gatekeeper stub is seeded (the startup contract handshake tolerates its absence).
//
//   TEST-504 — REQ-001/002/003/005/007/008/010: the FULL keyboard journey — Ctrl+Shift+U → the
//              SHARED picker retitled for capture → arrows/Enter → form (EIGHT non-error testids incl.
//              the hint, error ABSENT, zero dispatch) → type a '--json'-prefixed emoji title → Enter
//              in the textarea inserts a NEWLINE (never submits) → Ctrl+Enter submits ONCE → success
//              toast → modal closed → argv-log proves ONE ['submit','--app',root,'--json',item] call.
//   TEST-505 — REQ-003/004/006/007: change-root, CONV-030 button activation, single-flight, clean close.
//   TEST-506 — REQ-002/008/009: the disabled-feedback path — DISTINCT feedback-disabled in-modal,
//              refusal VERBATIM, draft byte-preserved, retry-after-enable clears the region.
//   TEST-525 — REQ-009 (FINDING-002/014): the http-refusal render (data-error-kind="cli-error",
//              DISTINCT from feedback-disabled, names the control plane, draft byte-preserved), then a
//              draft EDIT clears the error region (FINDING-008), then a generic exit-2 cli-error render.
//   TEST-526 — REQ-009 (FINDING-014, CONV-015): a genuine cli-timeout via delayMs > 15s renders the
//              INDETERMINATE copy (may-or-may-not + duplicate warning) end-to-end — never the definite copy.
//   TEST-527 — REQ-009/REQ-012 (FINDING-013): close (Escape) while a slow dispatch is in flight —
//              exactly ONE argv-log entry (no second dispatch), and the DETACHED failure outcome still
//              reports through pushToast as an error-kind toast enqueued EVEN with toasts disabled.
//   TEST-528 — REQ-003/REQ-009 (FINDING-008): after a failure, selecting a DIFFERENT root via
//              "Change project" clears the error region (its subject no longer exists), draft preserved.
//
// Runs RED today: the rev-1 tree ships no hint line, maps invoke shapes without the http/timeout
// render distinctions this suite now drives, drops the detached outcome silently, and never clears the
// failure on a draft edit / root change.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

type StubBehavior = 'ok' | 'disabled' | 'http' | 'cli-error'

/** A stub Orky feedback CLI (the plugin v0.28.0 `submit` surface). Runs under the SAME
 *  `execFile(process.execPath, [cliPath, ...args])` mechanism as the real plugin. Answers per
 *  mode.json across the complete result universe (FINDING-002/FINDING-014). */
const STUB_CLI = `
const fs = require('fs')
const path = require('path')
const i = process.argv.indexOf('submit')
const args = i >= 0 ? process.argv.slice(i) : process.argv.slice(1)
fs.appendFileSync(path.join(__dirname, 'argv-log.jsonl'), JSON.stringify(args) + '\\n')
let mode = { behavior: 'ok', delayMs: 0 }
try { mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) } catch {}
const shapes = {
  ok:          { code: 0, out: { ok: true, mode: 'file', id: 'IN-e2e0001', kind: 'work.request', path: 'inbox/IN-e2e0001.json' } },
  disabled:    { code: 1, out: { ok: false, mode: 'noop', error: 'feedback is disabled — the write path requires enable-feedback (an audited decision, ADR-027)' } },
  http:        { code: 1, out: { ok: false, mode: 'http', error: 'submit writes the LOCAL file inbox; this app uses the http control plane — submit via its inbox API instead' } },
  'cli-error': { code: 2, out: { error: 'disk full: the Orky inbox volume is out of space' } }
}
const shape = shapes[mode.behavior] || shapes.ok
setTimeout(() => { process.stdout.write(JSON.stringify(shape.out), () => process.exit(shape.code)) }, mode.delayMs || 0)
`

function seedPlugin(behavior: StubBehavior, delayMs = 0): { pluginDir: string; logPath: string; modePath: string } {
  const pluginDir = mkdtempSync(join(tmpdir(), 'termh-capture-plugin-'))
  mkdirSync(join(pluginDir, 'feedback'), { recursive: true })
  writeFileSync(join(pluginDir, 'feedback', 'cli.js'), STUB_CLI, 'utf8')
  const modePath = join(pluginDir, 'feedback', 'mode.json')
  writeFileSync(modePath, JSON.stringify({ behavior, delayMs }), 'utf8')
  return { pluginDir, logPath: join(pluginDir, 'feedback', 'argv-log.jsonl'), modePath }
}

function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

/** A minimal tracked project (a real dir; membership is all `submit` needs). */
function seedProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'termh-capture-proj-'))
  mkdirSync(join(proj, '.orky', 'features'), { recursive: true })
  return proj
}

function seedUserData(roots: string[], opts?: { toasts?: boolean }): string {
  const userData = mkdtempSync(join(tmpdir(), 'termh-capture-ud-'))
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
  if (opts?.toasts) writeFileSync(join(userData, 'quick.json'), JSON.stringify({ toastsEnabled: true }), 'utf8')
  return userData
}

function launch(userData: string, pluginDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, ORKY_PLUGIN_DIR: pluginDir }
  })
}

type Win = Awaited<ReturnType<ElectronApplication['firstWindow']>>

/** Chord → capture picker → keyboard-select the first (only) listed root → the capture form. */
async function openCaptureAndPickRoot(win: Win): Promise<void> {
  await win.keyboard.press('Control+Shift+KeyU')
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('Enter') // listbox holds focus on open; sel=0 commits the first root
  await expect(win.getByTestId('orky-capture')).toBeVisible({ timeout: 10_000 })
}

const focusedTestId = (win: Win): Promise<string | null> =>
  win.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null)

test('TEST-504 REQ-001/002/003/005/007/008/010 keyboard-only capture end-to-end: chord → capture-retitled picker → form → boundary-payload draft → one submit → honest toast → byte-verbatim inbox item', async () => {
  test.setTimeout(120_000)
  const proj = seedProject()
  const userData = seedUserData([proj], { toasts: true })
  const { pluginDir, logPath } = seedPlugin('ok')
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // ── invoke via the REAL chord (workspace-independent — nothing else was created first)
  await win.keyboard.press('Control+Shift+KeyU')
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  // REQ-003/FINDING-005: the SHARED picker (same testid = component identity), renamed for capture —
  // accessible name AND visible heading agree, and neither says "bind"
  await expect(picker).toHaveAttribute('aria-label', /capture/i)
  await expect(picker).toContainText(/capture/i)
  await expect(picker).not.toContainText('Bind to a tracked Orky project')
  await expect(picker.getByTestId('orky-root-picker-item')).toHaveCount(1, { timeout: 10_000 })

  await win.keyboard.press('Enter') // keyboard-select the tracked root
  const form = win.getByTestId('orky-capture')
  await expect(form).toBeVisible({ timeout: 10_000 })

  // ── REQ-002 (FINDING-003/012): the EIGHT non-error testids render (incl. the hint); error ABSENT
  for (const tid of ['orky-capture-title', 'orky-capture-detail', 'orky-capture-target', 'orky-capture-change-root', 'orky-capture-submit', 'orky-capture-cancel', 'orky-capture-hint']) {
    await expect(win.getByTestId(tid)).toBeVisible()
  }
  // the hint makes the fast-capture keys discoverable BEFORE the first accidental submit (FINDING-012)
  const hint = win.getByTestId('orky-capture-hint')
  await expect(hint).toContainText(/enter/i)
  await expect(hint).toContainText(/esc/i)
  await expect(win.getByTestId('orky-capture-error')).toHaveCount(0)
  await expect(win.getByTestId('orky-capture-target')).toHaveText(proj) // the chosen root, verbatim
  // whitespace-only title keeps submit disabled (the ONLY client-side gate)
  await expect(win.getByTestId('orky-capture-submit')).toBeDisabled()
  // ── REQ-006: opening the flow dispatched NOTHING
  expect(readLog(logPath)).toEqual([])

  // ── the draft: a '--json'-prefixed emoji/CJK title (REQ-010 boundary), typed into the autofocused title
  expect(await focusedTestId(win)).toBe('orky-capture-title')
  const title = '--json 🚀 修复 the Ω thing'
  await win.keyboard.type(title)
  await expect(win.getByTestId('orky-capture-submit')).toBeEnabled()
  // Tab: title → detail (the pinned order); Enter INSIDE the textarea is a newline, never a submit
  await win.keyboard.press('Tab')
  expect(await focusedTestId(win)).toBe('orky-capture-detail')
  await win.keyboard.type('first line')
  await win.keyboard.press('Enter')
  await win.keyboard.type('second line')
  expect(await win.getByTestId('orky-capture-detail').inputValue()).toBe('first line\nsecond line')
  expect(readLog(logPath)).toEqual([]) // the Enter above dispatched nothing (REQ-007 matrix)

  // ── mod+Enter from anywhere in the form submits ONCE (REQ-006/REQ-007)
  await win.keyboard.press('Control+Enter')
  // success (ok && dispatched): modal closes; ONE suppressible success toast with the D5 copy
  await expect(win.getByTestId('orky-capture')).toHaveCount(0, { timeout: 15_000 })
  const toast = win.getByTestId('toast')
  await expect(toast).toHaveCount(1, { timeout: 10_000 })
  await expect(toast).toContainText(/captured/i)
  await expect(toast).toContainText(/queued/i)
  await expect(toast).toContainText(/triage/i)
  await expect(toast).toContainText(proj)                          // names the root
  await expect(toast).not.toContainText(/accepted|started|created/i) // capture ≠ accept ≠ apply ≠ triage

  // ── the wire truth (REQ-005/REQ-010/REQ-013): ONE submit, the pinned argv, byte-verbatim payload
  const log = readLog(logPath)
  expect(log).toHaveLength(1)
  expect(log[0].slice(0, 4)).toEqual(['submit', '--app', proj, '--json'])
  expect(log[0]).toHaveLength(5)
  const item = JSON.parse(log[0][4])
  expect(item.kind).toBe('work.request')
  expect(item.title).toBe(title)                                   // byte-verbatim, '--json' prefix intact
  expect(item.detail).toBe('first line\nsecond line')              // the typed newline preserved
  expect(Object.keys(item).sort()).toEqual(['detail', 'kind', 'title']) // no phase, no feature, no extras

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-505 REQ-003/004/006/007 gesture-tying + CONV-030: change-root/cancel activate as THEMSELVES with zero dispatch, the prior root survives a cancelled re-pick, double-Enter is single-flight, Escape/cancel close clean, reopen is fresh', async () => {
  test.setTimeout(120_000)
  const proj = seedProject()
  const userData = seedUserData([proj])
  const { pluginDir, logPath } = seedPlugin('ok', 1500) // slow CLI so the double-gesture race is real
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // ── change-root: Enter on the FOCUSED change-root button opens the picker — never submits (CONV-030)
  await openCaptureAndPickRoot(win)
  await win.keyboard.press('Tab') // title → detail
  await win.keyboard.press('Tab') // detail → change-root (submit is disabled: empty title)
  expect(await focusedTestId(win)).toBe('orky-capture-change-root')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  expect(readLog(logPath)).toEqual([])
  // cancelling the re-pick returns to the form with the PRIOR root intact (REQ-003)
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-capture')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId('orky-capture-target')).toHaveText(proj)

  // ── single-flight: two Enter gestures before the slow result settles → exactly ONE dispatch
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.type('double fire')
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter') // in-flight: submit affordances disabled, gesture is a no-op
  await expect(win.getByTestId('orky-capture')).toHaveCount(0, { timeout: 20_000 }) // settles → closes
  expect(readLog(logPath)).toHaveLength(1)
  expect(readLog(logPath)[0][2]).toBe(proj) // projectRoot byte-equal to the displayed target (REQ-004 keying)
  expect(JSON.parse(readLog(logPath)[0][4]).title).toBe('double fire')

  // ── Enter on the FOCUSED cancel button cancels — never submits (CONV-030); reopen starts fresh
  await openCaptureAndPickRoot(win)
  await win.keyboard.type('draft to discard')            // autofocused title
  await win.keyboard.press('Tab')                        // → detail
  await win.keyboard.press('Tab')                        // → change-root
  await win.keyboard.press('Tab')                        // → submit (enabled: non-empty title)
  await win.keyboard.press('Tab')                        // → cancel (the pinned Tab order)
  expect(await focusedTestId(win)).toBe('orky-capture-cancel')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-capture')).toHaveCount(0)
  expect(readLog(logPath)).toHaveLength(1)               // still just the one earlier dispatch

  // ── Escape from inside the form closes with zero dispatch; the discarded draft never reappears
  await openCaptureAndPickRoot(win)
  expect(await win.getByTestId('orky-capture-title').inputValue()).toBe('') // fresh, no residue (REQ-012)
  await win.keyboard.type('escape me')
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-capture')).toHaveCount(0)
  expect(readLog(logPath)).toHaveLength(1)

  // ── cancelling the INITIAL picker abandons the capture entirely (REQ-003): no form, no dispatch
  await win.keyboard.press('Control+Shift+KeyU')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  await expect(win.getByTestId('orky-capture')).toHaveCount(0)
  expect(readLog(logPath)).toHaveLength(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-506 REQ-002/008/009 the disabled-feedback path: a DISTINCT in-modal feedback-disabled state carrying the CLI refusal VERBATIM, draft byte-preserved, then a successful retry clears the error region', async () => {
  test.setTimeout(120_000)
  const proj = seedProject()
  const userData = seedUserData([proj])
  const { pluginDir, logPath, modePath } = seedPlugin('disabled')
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCaptureAndPickRoot(win)
  const title = 'urgent: the tracker drops idle roots'
  await win.keyboard.type(title)                          // autofocused title
  await win.keyboard.press('Tab')
  await win.keyboard.type('seen twice on relaunch')
  // Enter in the TITLE submits (REQ-007 matrix row 2)
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')

  // the DISTINCT non-dispatch outcome, rendered IN-MODAL (never a suppressible toast-only signal)
  const err = win.getByTestId('orky-capture-error')
  await expect(err).toBeVisible({ timeout: 15_000 })
  await expect(err).toHaveAttribute('data-error-kind', 'feedback-disabled')
  await expect(err).toContainText('feedback is disabled — the write path requires enable-feedback (an audited decision, ADR-027)') // VERBATIM
  await expect(win.getByTestId('orky-capture')).toBeVisible()      // modal stays open
  await expect(win.getByTestId('toast')).toHaveCount(0)            // no success signal of any kind
  // draft byte-preserved for an explicit retry (REQ-009)
  expect(await win.getByTestId('orky-capture-title').inputValue()).toBe(title)
  expect(await win.getByTestId('orky-capture-detail').inputValue()).toBe('seen twice on relaunch')
  expect(readLog(logPath)).toHaveLength(1)
  // no enable affordance exists in the modal — enabling is an audited human decision OUTSIDE Termhalla
  // (the error TEXT legitimately contains the word enable-feedback — it is the CLI refusal verbatim;
  // what must not exist is an enable AFFORDANCE)
  await expect(win.getByRole('button', { name: /enable/i })).toHaveCount(0)

  // ── the human enables feedback out-of-band (ADR-027); an explicit retry now succeeds and the
  //    error region DISAPPEARS (REQ-002's retry vector, FINDING-003)
  writeFileSync(modePath, JSON.stringify({ behavior: 'ok', delayMs: 0 }), 'utf8')
  await expect(win.getByTestId('orky-capture-submit')).toBeEnabled()
  await win.getByTestId('orky-capture-submit').focus()
  await win.keyboard.press('Enter')                                // native button activation (CONV-030)
  await expect(win.getByTestId('orky-capture')).toHaveCount(0, { timeout: 15_000 })
  expect(readLog(logPath)).toHaveLength(2)
  expect(JSON.parse(readLog(logPath)[1][4]).title).toBe(title)     // the SAME draft, retried verbatim

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-525 REQ-009 http-refusal renders as cli-error (DISTINCT from feedback-disabled, names the control plane), a draft edit clears the error region (FINDING-008), and a generic exit-2 cli-error renders verbatim', async () => {
  test.setTimeout(120_000)
  const proj = seedProject()
  const userData = seedUserData([proj])
  const { pluginDir, logPath, modePath } = seedPlugin('http')
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCaptureAndPickRoot(win)
  const title = 'this project talks to the control plane'
  await win.keyboard.type(title)
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')

  // http refusal → the UNIFORM cli-error render (NOT the feedback-disabled state); message VERBATIM
  const err = win.getByTestId('orky-capture-error')
  await expect(err).toBeVisible({ timeout: 15_000 })
  await expect(err).toHaveAttribute('data-error-kind', 'cli-error')
  await expect(err).toContainText('http control plane')            // the redirect, verbatim
  await expect(win.getByTestId('orky-capture')).toBeVisible()      // modal stays open
  expect(await win.getByTestId('orky-capture-title').inputValue()).toBe(title) // draft preserved

  // ── FINDING-008: mutating the draft clears the failure — its subject (the last request) is stale
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.type(' more')
  await expect(win.getByTestId('orky-capture-error')).toHaveCount(0)

  // ── a generic exit-2 internal error renders as cli-error too, message verbatim (uniform branch)
  writeFileSync(modePath, JSON.stringify({ behavior: 'cli-error', delayMs: 0 }), 'utf8')
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')
  await expect(err).toBeVisible({ timeout: 15_000 })
  await expect(err).toHaveAttribute('data-error-kind', 'cli-error')
  await expect(err).toContainText('disk full: the Orky inbox volume is out of space')
  await expect(err).not.toContainText(/feedback is disabled/i)     // never misdiagnosed
  expect(readLog(logPath)).toHaveLength(2)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-526 REQ-009 a genuine cli-timeout (delayMs > the 15s runner timeout) renders the INDETERMINATE copy (may-or-may-not + duplicate warning) end-to-end — never the definite non-capture copy', async () => {
  test.setTimeout(180_000)
  const proj = seedProject()
  const userData = seedUserData([proj])
  // delayMs beyond DEFAULT_CLI_TIMEOUT_MS (15s): the runner times out, the child is unref()'d and may
  // still complete its write → the honest verdict is INDETERMINATE (CONV-015).
  const { pluginDir } = seedPlugin('ok', 17_000)
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCaptureAndPickRoot(win)
  const title = 'a slow write that outlives the timeout'
  await win.keyboard.type(title)
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')

  const err = win.getByTestId('orky-capture-error')
  await expect(err).toBeVisible({ timeout: 30_000 })                       // waits out the 15s timeout
  await expect(err).toHaveAttribute('data-error-kind', 'cli-timeout')
  await expect(err).toContainText(/may (or may not )?have been/i)          // INDETERMINATE wording
  await expect(err).toContainText(/duplicate/i)                            // the retry-duplicate warning
  await expect(err).not.toContainText(/was not captured|failed to capture|did not go through/i) // never definite
  await expect(win.getByTestId('orky-capture')).toBeVisible()              // modal stays open, draft intact
  expect(await win.getByTestId('orky-capture-title').inputValue()).toBe(title)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-527 REQ-009/REQ-012 close (Escape) while a dispatch is in flight: exactly ONE dispatch, and the DETACHED failure outcome still reports through pushToast as an error-kind toast — enqueued even with toasts DISABLED (FINDING-013)', async () => {
  test.setTimeout(120_000)
  const proj = seedProject()
  const userData = seedUserData([proj]) // toasts DISABLED (default) — error-kind toasts must still enqueue
  const { pluginDir, logPath } = seedPlugin('disabled', 2000) // slow refusal so we can close mid-flight
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCaptureAndPickRoot(win)
  const title = 'the capture I abandoned mid-flight'
  await win.keyboard.type(title)
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')                       // dispatch starts (2s in flight)
  // close IMMEDIATELY — decision #8: close cannot abort the non-idempotent write; the draft is lost,
  // the write DETACHES (REQ-009/FINDING-013)
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('orky-capture')).toHaveCount(0)

  // the detached outcome settles a FAILURE — it must NOT be dropped: an error-kind toast enqueues even
  // though toasts are disabled (the toasts-slice.ts:20 never-suppressed chokepoint), naming the loss
  const toast = win.getByTestId('toast')
  await expect(toast).toHaveCount(1, { timeout: 15_000 })
  await expect(toast).toContainText(title)               // names the lost capture

  // and no second dispatch was issued by the close (single-flight / detach, REQ-006/REQ-012)
  expect(readLog(logPath)).toHaveLength(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-528 REQ-003/REQ-009 after a failure, selecting a DIFFERENT root via "Change project" clears the error region — its subject no longer exists — with the draft preserved (FINDING-008)', async () => {
  test.setTimeout(120_000)
  const projA = seedProject()
  const projB = seedProject()
  const userData = seedUserData([projA, projB])
  const { pluginDir } = seedPlugin('disabled')
  const app = await launch(userData, pluginDir)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // pick root A (sel=0), submit → the feedback-disabled failure renders for A
  await openCaptureAndPickRoot(win)
  await expect(win.getByTestId('orky-capture-target')).toHaveText(projA)
  const title = 'idea that outlives a root change'
  await win.keyboard.type(title)
  await win.getByTestId('orky-capture-title').focus()
  await win.keyboard.press('Enter')
  const err = win.getByTestId('orky-capture-error')
  await expect(err).toBeVisible({ timeout: 15_000 })
  await expect(err).toHaveAttribute('data-error-kind', 'feedback-disabled')

  // Change project → pick the DIFFERENT root B → the stale failure (about A) must clear
  await win.getByTestId('orky-capture-change-root').click()
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')                  // sel: A → B
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-capture')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId('orky-capture-target')).toHaveText(projB)
  await expect(win.getByTestId('orky-capture-error')).toHaveCount(0) // cleared — the subject changed
  expect(await win.getByTestId('orky-capture-title').inputValue()).toBe(title) // draft preserved

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
