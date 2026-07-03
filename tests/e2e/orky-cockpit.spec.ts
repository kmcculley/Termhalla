// FROZEN e2e suite — feature 0011-orky-workspace-template (phase 4). Playwright-for-Electron
// against out/. NOT in the `npm test` gate (vitest includes only tests/**/*.test.ts); must be
// witnessed green against the built implementation before the review gate closes (CONV-052).
//
// Covers what the node harness cannot reach: the rendered single-gesture flows (palette,
// templates-menu row, decision-queue button), the relabelled shared picker, the rendered
// orky-pane detail lifecycle (REQ-005's rendered half), and the window-reload durability
// round-trips (the did-finish-load re-push, window-manager.ts:144 — the FINDING-001 boundary).
//
// FINDING-017 (0010): node-pty's native binding is not built in this checkout, so LIVE terminal
// spawns fail environment-wide. Per the work order these tests pin the LAYOUT/ARGV halves — the
// terminal TILE commits and the SAVED workspace file carries { kind, shellId, cwd } with cwd
// byte-verbatim — never a live-PTY prompt/transcript assertion.
//
// AMENDED 2026-07-03 — ESC-001 / FINDING-008 tests-phase loopback (the CONV-019 supersession
// discipline: a sanctioned, scheduled amendment executed by the tests actor at a tests loopback,
// never an implementer edit). Two frozen tests carried TEST-AUTHORING defects, fixed in place
// with their INTENT byte-unchanged:
//   TEST-677 — counted tabs via [data-tab-id] while the menu pick's inline rename was open (a
//              ws-rename-<id> INPUT carries no data-tab-id), so the count could never reach 2
//              regardless of the durability under test. Fixed via commitMenuPickRename below.
//   TEST-678 — selected the saved template row with a STRING hasText ('CK'), which is
//              case-insensitive SUBSTRING matching and also hits the always-rendered built-in
//              row's own label ("Orky project coCKpit…") — a Playwright strict-mode two-element
//              resolution. Fixed with an exact-text regex; the same rename commit applies. The
//              first witnessed run then unmasked a THIRD authoring defect past the old failure
//              point: the post-reload `.first()` orky-pane check resolved to the first cockpit's
//              pane inside a non-active (hidden) host — now scoped to the ACTIVE host.
// No assertion was weakened; no selector was widened beyond the rename-state reality.
//
//   TEST-673 — REQ-003/REQ-001/REQ-002/REQ-005: palette → relabelled picker → cockpit; Escape
//              first creates NOTHING (and writes no template); the saved file pins schema 8, the
//              exact terminal config keys, byte-verbatim root/cwd, the row layout.
//   TEST-674 — REQ-003: the tpl-orky-cockpit built-in row — always rendered (co-rendering with
//              "No templates yet."), never deletable, keyboard-activated → picker → cockpit;
//              quick.json gains NO template from the gesture.
//   TEST-675 — REQ-004: decision-queue-open-cockpit — NO picker, keyboard (Enter) activation,
//              cockpit at the group's root, exactly one new workspace.
//   TEST-676 — REQ-002: the gesture-opened cockpit SURVIVES a window reload with both panes (the
//              vector that would have caught FINDING-001 on the cockpit path).
//   TEST-677 — REQ-006: a MENU-instantiated workspace (pre-F11 machinery, no F11 UI needed)
//              survives a window reload — RED against the SHIPPED build today: the workspace is
//              silently dropped by the did-finish-load re-push because newWorkspaceFromTemplate
//              never reports. This is the live-defect witness.
//   TEST-678 — REQ-005/REQ-006: the cockpit's orky-pane RENDERS its detail for the fixture root
//              (mount → bound → displayed); save-as-template → menu re-instantiation reproduces
//              the cockpit; the re-instantiated workspace survives a reload.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

/** A synthetic .orky/ project (the orky-pane.spec fixture): one needs-human feature (open
 *  escalation — keeps the decision queue non-empty) + one clean-done feature. */
function seedOrkyProject(prefix = 'termh-cockpit-'): string {
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

async function paletteRun(win: Win, query: string, expectItem?: string | RegExp): Promise<void> {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill(query)
  if (expectItem) await expect(win.getByTestId('palette-item-0')).toContainText(expectItem, { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
}
async function saveAll(win: Win): Promise<void> {
  await paletteRun(win, 'save all')
  await win.waitForTimeout(1_000)
}
/** Open the cockpit gesture from the palette and pick the FIRST listed root by keyboard. */
async function openCockpitViaPalette(win: Win): Promise<void> {
  await paletteRun(win, 'cockpit', /Orky project workspace/)
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
}
async function expectCockpit(win: Win, proj: string): Promise<void> {
  const activeHost = win.locator('[data-testid="workspace-host"][data-active="true"]')
  await expect(activeHost.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 20_000 })
  await expect(activeHost.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 20_000 })
  await expect(activeHost.locator('[data-testid^="tile-"]')).toHaveCount(2)
}
/** quick.json must carry NO saved template from a cockpit gesture (templates change only via the
 *  user's explicit save/delete — REQ-006/REQ-003). Tolerant of the file not existing yet. */
function expectNoPersistedTemplate(userData: string): void {
  const quickPath = join(userData, 'quick.json')
  if (!existsSync(quickPath)) return
  const raw = readFileSync(quickPath, 'utf8')
  expect(/"templates":\s*\[\s*\{/.test(raw), 'quick.json must hold no template entry').toBe(false)
  expect(raw).not.toContain('Orky project cockpit') // the built-in row is chrome, never persisted
}
/** AMENDED 2026-07-03 (ESC-001 / FINDING-008): a TemplatesMenu pick calls onPicked → startRename
 *  (WorkspaceTabs.tsx:61-69), so the NEW workspace's tab renders as a ws-rename-<id> INPUT that
 *  carries no data-tab-id — a bare [data-tab-id] count can never see the new workspace, no matter
 *  how long it waits. Commit the inline rename (Enter keeps the pre-filled name, so the workspace
 *  name is unchanged) so every tab renders as a data-tab-id button again. Each caller's INTENT —
 *  the menu-instantiated workspace SURVIVES the did-finish-load re-push — is untouched; this
 *  needs no live pty. */
async function commitMenuPickRename(win: Win): Promise<void> {
  const rename = win.locator('[data-testid^="ws-rename-"]')
  await expect(rename).toBeVisible({ timeout: 10_000 })
  await rename.press('Enter')
  await expect(rename).toHaveCount(0)
}

test('TEST-673 REQ-003 REQ-001 REQ-002 REQ-005 palette → RELABELLED picker → one-gesture cockpit; Escape first creates nothing; the saved workspace pins schema 8, byte-verbatim root/cwd, the exact terminal keys, and the row layout', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck1-'))
  const proj = seedOrkyProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // Escape path FIRST: cancel in the (member-listing) picker commits NOTHING
  await paletteRun(win, 'cockpit', /Orky project workspace/)
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  // the F11 relabel: heading + aria-label are cockpit-coherent, never the F9 /bind/i default
  const aria = await picker.getAttribute('aria-label')
  expect(aria ?? '').toMatch(/cockpit|workspace/i)
  expect(aria ?? '').not.toMatch(/bind/i)
  const pickerText = (await picker.textContent()) ?? ''
  expect(pickerText).toMatch(/cockpit|workspace/i)
  expect(pickerText).not.toMatch(/bind/i)
  await win.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(win.locator('[data-testid="orky-pane"]')).toHaveCount(0)
  await expect(win.locator('[data-tab-id]')).toHaveCount(1) // no workspace created
  expectNoPersistedTemplate(userData)

  // the single gesture: palette → pick → cockpit (keyboard-only end-to-end)
  await openCockpitViaPalette(win)
  await expectCockpit(win, proj)
  await expect(win.locator('[data-tab-id]')).toHaveCount(2)

  // the LAYOUT/ARGV pin (FINDING-017: never the live pty): save, then read the persisted file
  await saveAll(win)
  const wsDir = join(userData, 'workspaces')
  const saved = readdirSync(wsDir).map(f => readFileSync(join(wsDir, f), 'utf8')).find(s => s.includes('"orky"'))
  expect(saved, 'a saved workspace must contain the cockpit').toBeTruthy()
  const parsed = JSON.parse(saved!) as {
    schemaVersion: number
    workspace: { name: string; layout: { direction: string; first: string; second: string; splitPercentage?: number }; panes: Record<string, { config: Record<string, unknown> }> }
  }
  expect(parsed.schemaVersion).toBe(8) // F9's bump stands — no new schema (REQ-007)
  const configs = Object.values(parsed.workspace.panes).map(p => p.config)
  expect(configs).toHaveLength(2)
  const orky = configs.find(c => c.kind === 'orky')!
  expect(orky.root).toBe(proj) // byte-verbatim
  const term = configs.find(c => c.kind === 'terminal')!
  expect(Object.keys(term).sort()).toEqual(['cwd', 'kind', 'shellId']) // no launch/resumeAi/env/runCommands
  expect(term.cwd).toBe(proj)  // byte-verbatim — reaches pty.spawn through the EXISTING chain
  const layout = parsed.workspace.layout
  expect(layout.direction).toBe('row')
  expect((parsed.workspace.panes[layout.first].config as { kind: string }).kind).toBe('orky')
  expect((parsed.workspace.panes[layout.second].config as { kind: string }).kind).toBe('terminal')
  expect('splitPercentage' in layout).toBe(false)
  expect(parsed.workspace.name.startsWith('Orky: ')).toBe(true)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-674 REQ-003 the tpl-orky-cockpit BUILT-IN row: rendered while "No templates yet." co-renders, carries no delete affordance, activates by KEYBOARD (Enter) into the relabelled picker, and the gesture persists NO template', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck2-'))
  const proj = seedOrkyProject('termh-cockpit-tpl-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await win.getByTestId('templates-button').click()
  await expect(win.getByTestId('templates-menu')).toBeVisible()
  const row = win.getByTestId('tpl-orky-cockpit')
  await expect(row).toBeVisible()
  await expect(row).toContainText(/Orky project cockpit/)
  // co-renders with the SAVED-templates empty copy (which keeps referring to saved templates)
  await expect(win.getByTestId('templates-menu')).toContainText('No templates yet.')
  // never deletable: no delete control targets the built-in row
  await expect(win.locator('[data-testid="tpl-del-orky-cockpit"]')).toHaveCount(0)

  // KEYBOARD activation (CONV-030: Enter on the focused native button activates it)
  await row.focus()
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('templates-menu')).toHaveCount(0) // the menu closes on pick
  const picker = win.getByTestId('orky-root-picker')
  await expect(picker).toBeVisible({ timeout: 10_000 })
  expect((await picker.getAttribute('aria-label')) ?? '').not.toMatch(/bind/i) // the F11 relabel here too
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expectCockpit(win, proj)

  // the cockpit gesture created a WORKSPACE, not a quick.json template
  await win.waitForTimeout(1_200) // let any (wrongly) scheduled quick-save debounce flush
  expectNoPersistedTemplate(userData)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-675 REQ-004 decision-queue-open-cockpit: NO picker, keyboard Enter activation, the cockpit opens at the GROUP root, exactly one new workspace', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck3-'))
  const proj = seedOrkyProject('termh-cockpit-dq-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  // the esc-feature fixture keeps the queue non-empty; open the drawer via its status-bar toggle
  const toggle = win.getByTestId('orky-queue-toggle')
  await expect(toggle).toContainText('1', { timeout: 30_000 })
  await toggle.click()
  await expect(win.getByTestId('decision-queue-panel')).toBeVisible()

  const btn = win.locator(`[data-testid="decision-queue-open-cockpit"][data-project-root="${csspath(proj)}"]`)
  await expect(btn).toBeVisible({ timeout: 20_000 })
  await expect(btn).toHaveAttribute('data-project-root', proj)

  // keyboard activation of the focused button (CONV-030) — the pre-selected path skips the picker
  await btn.focus()
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0) // NO picker, ever
  await expectCockpit(win, proj)
  await expect(win.getByTestId('orky-root-picker')).toHaveCount(0)
  await expect(win.locator('[data-tab-id]')).toHaveCount(2) // exactly ONE new workspace

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-676 REQ-002 the gesture-opened cockpit SURVIVES a window reload (the did-finish-load re-push) with both panes — the FINDING-001 boundary on the cockpit path', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck4-'))
  const proj = seedOrkyProject('termh-cockpit-rel-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCockpitViaPalette(win)
  await expectCockpit(win, proj)
  await expect(win.locator('[data-tab-id]')).toHaveCount(2)
  await saveAll(win)

  // the reload re-pushes main's authoritative windows[] — without the report the cockpit is
  // silently DROPPED here even though its file is on disk (an orphan no window ever loads)
  await win.reload()
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30_000 })
  await expect(win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(win.locator('[data-testid="workspace-host"][data-active="true"] [data-testid^="terminal-"]')).toHaveCount(1, { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-677 REQ-006 a MENU-instantiated template workspace survives a window reload — the shared-seam repair, witnessed on PRE-F11 machinery (RED against the shipped build: the workspace is silently dropped)', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck5-'))
  const app = await launch(userData)
  const win = await app.firstWindow()

  // a plain terminal workspace — no F11 UI involved: this vector exercises ONLY the shipped
  // save-template → instantiate path plus the decision-9 repair
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('Solo')
  await win.getByTestId('tpl-save').click()
  await win.locator('[data-testid^="tpl-"]', { hasText: 'Solo' }).click()
  // AMENDED 2026-07-03 (ESC-001 / FINDING-008): the pick opens the inline rename — commit it so
  // the new workspace's tab renders with data-tab-id before counting (intent unchanged)
  await commitMenuPickRename(win)
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 20_000 })
  await saveAll(win)

  await win.reload()
  await expect(
    win.locator('[data-tab-id]'),
    'FINDING-001: the menu-instantiated workspace must survive the did-finish-load re-push — today newWorkspaceFromTemplate never reports it into main\'s windows[], so the drop loop deletes it'
  ).toHaveCount(2, { timeout: 30_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-678 REQ-005 REQ-006 the cockpit orky-pane RENDERS its detail (mount → bound → displayed); save-as-template → menu re-instantiation reproduces the cockpit; the re-instantiated workspace survives a reload', async () => {
  test.setTimeout(150_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ck6-'))
  const proj = seedOrkyProject('termh-cockpit-reuse-')
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })

  await openCockpitViaPalette(win)
  await expectCockpit(win, proj)
  // REQ-005's RENDERED half: the pane displays the fixture's detail through the shipped one-fetch
  // discipline (the count half is frozen TEST-420; the trigger half is the structural scan) —
  // both fixture features render, observed through output, never a spy
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane.locator('[data-testid="orky-pane-feature"]')).toHaveCount(2, { timeout: 20_000 })

  // D3: the cockpit is a REAL workspace — the normal save-template gesture round-trips it
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('CK')
  await win.getByTestId('tpl-save').click()
  // AMENDED 2026-07-03 (ESC-001 / FINDING-008): a STRING hasText filter is case-insensitive
  // SUBSTRING matching, so hasText 'CK' also resolved the always-rendered built-in row (its own
  // label "Orky project coCKpit…" contains 'ck') — a Playwright strict-mode violation. Select
  // the saved row by EXACT text instead. (Proposed CONV: an e2e locator that must resolve
  // exactly ONE element must never rely on a string hasText filter that can occur inside a
  // sibling row's label — use an exact-text regex or a unique testid.)
  await win.locator('[data-testid^="tpl-"]', { hasText: /^CK$/ }).click()
  // AMENDED 2026-07-03 (ESC-001 / FINDING-008): the pick opens the inline rename — commit it so
  // the tab count below can see the re-instantiated workspace (intent unchanged)
  await commitMenuPickRename(win)
  await expectCockpit(win, proj) // the re-instantiated ACTIVE workspace reproduces the structure
  await expect(win.locator('[data-tab-id]')).toHaveCount(3)
  await saveAll(win)

  // the previously-gapped boundary, with the cockpit vehicle: the re-instantiated workspace
  // survives the reload re-push (a loader-only check is NOT this criterion)
  await win.reload()
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30_000 })
  // AMENDED 2026-07-03 (ESC-001 / FINDING-008, unmasked by the fixes above): `.first()` on the
  // unscoped orky-pane locator resolves to the FIRST cockpit's pane, which lives in a NON-active
  // (hidden) workspace host after the reload — the survival claim is that the RE-INSTANTIATED
  // workspace (the last-reported activeId) comes back rendering its cockpit, so scope to the
  // active host (the expectCockpit discipline). Intent unchanged.
  await expect(win.locator(`[data-testid="workspace-host"][data-active="true"] [data-testid="orky-pane"][data-root="${csspath(proj)}"]`)).toBeVisible({ timeout: 30_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
