// FROZEN e2e suite — feature 0007-orky-action-dispatch (phase 4 / DoD acceptance, REQ-017).
// Deliberately MINIMAL — this feature ships NO renderer UI (D1). The only things worth an e2e are:
// (1) the four `orkyAction:*` channels genuinely round-trip through preload/`api.ts` against the REAL
// packaged app (not just the mocked `register-orky-action.test.ts` unit harness), and (2) no new visible
// UI renders anywhere (a code-review guard made executable). Runs against `out/` — `npm run build` first.
//
// The dispatch itself is expected to fail (root-not-allowed / orky-cli-not-found — this CI/dev box has no
// tracked registry root and no ORKY_PLUGIN_DIR configured) — that failure is STILL a well-formed
// `OrkyActionResult`, which is exactly what proves the round-trip: a malformed/missing preload binding
// would instead throw `window.termhalla.orkyDriveStatus is not a function` inside the page, not return a
// structured result.
//
// Runs RED today: `window.termhalla.orkyResolveEscalation`/`orkySubmitWork`/`orkyRecordHumanGate`/
// `orkyDriveStatus` do not exist on the preload bridge yet (TASK-011 not done).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

test('TEST-281 REQ-001/018 the four orkyAction:* methods exist on window.termhalla and round-trip a well-formed OrkyActionResult', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-orkyaction-'))
  const app: ElectronApplication = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const result = await win.evaluate(async () => {
    const api = (window as unknown as { termhalla: Record<string, (...a: unknown[]) => Promise<unknown>> }).termhalla
    const kinds = ['orkyResolveEscalation', 'orkySubmitWork', 'orkyRecordHumanGate', 'orkyDriveStatus']
    const missing = kinds.filter(k => typeof api[k] !== 'function')
    const drive = await api.orkyDriveStatus({ projectRoot: 'C:/does/not/exist', feature: 'nope' })
    return { missing, drive }
  })

  expect(result.missing).toEqual([]) // every method exists on the preload bridge
  expect(result.drive).toMatchObject({ ok: false, dispatched: false })
  expect(typeof (result.drive as { errorKind?: string }).errorKind).toBe('string')
  expect((result.drive as { errorKind: string }).errorKind.length).toBeGreaterThan(0)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})

test('TEST-282 REQ-017 no new visible UI renders anywhere: no element carries an orky-action-scoped test id', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-orkyaction2-'))
  const app: ElectronApplication = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await expect(win.locator('[data-testid*="orky-action"]')).toHaveCount(0)
  await expect(win.locator('[data-testid*="orkyaction"]')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
