// FROZEN e2e suite — feature 0002-pane-toolbar-split-control (phase 4).
// Drives the NEW combined compass + kind popover that replaces the two split buttons. The testids
// (`split-${id}`, `split-dir-{up,left,right,down}-${id}`, `split-kind-{terminal,editor,explorer}-${id}`,
// `split-menu`) are the REQ-013 contract. Against the current (unimplemented) code these assertions
// fail — the popover still renders the old `split-terminal/-editor/-explorer` buttons and the second
// `split-col-${id}` button. That RED state is the integrity proof; do not implement to satisfy it.
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function firstPaneId(win: import('@playwright/test').Page): Promise<string> {
  const tileTestId = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-testid')
  return tileTestId!.replace('tile-', '')
}

/** Launch fresh, add the first terminal, return app + the pane id. */
async function launchWithTerminal(prefix: string): Promise<{ app: ElectronApplication; win: import('@playwright/test').Page; paneId: string }> {
  const userData = mkdtempSync(join(tmpdir(), prefix))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const paneId = await firstPaneId(win)
  return { app, win, paneId }
}

// TEST-006 — REQ-003/REQ-013: exactly one split button; the old `split-col-` button is gone; opening
// the popover commits nothing (tile count unchanged on open).
test('TEST-006 REQ-003 one split button, no split-col, opening does not commit', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-one-')
  await expect(win.getByTestId(`split-${paneId}`)).toHaveCount(1)
  await expect(win.getByTestId(`split-col-${paneId}`)).toHaveCount(0)

  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1)
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  // Opening the popover must NOT perform a split.
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-007 — REQ-004: the popover is portalled to <body> — it must NOT be nested inside the source
// react-mosaic tile (whose transform would clip/mis-stack a fixed/absolute child).
test('TEST-007 REQ-004 split popover portals to <body> (not inside the .mosaic-tile)', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-portal-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  const insideTile = await win.getByTestId('split-menu').evaluate(el => !!(el as { closest(sel: string): unknown }).closest('.mosaic-tile'))
  expect(insideTile).toBe(false)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-008 — REQ-005: all four directions always rendered and enabled — both with a single pane and
// after a prior split (≥2 panes).
test('TEST-008 REQ-005 compass shows all four enabled directions, single pane and after a split', async () => {
  test.setTimeout(60_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-four-')
  const dirs = ['up', 'left', 'right', 'down'] as const

  // Single pane: all four present + enabled.
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  for (const d of dirs) {
    await expect(win.getByTestId(`split-dir-${d}-${paneId}`)).toBeVisible()
    await expect(win.getByTestId(`split-dir-${d}-${paneId}`)).toBeEnabled()
  }

  // Commit a split (Terminal kind, right) so the workspace has ≥2 panes, then re-open and re-check.
  await win.getByTestId(`split-kind-terminal-${paneId}`).click()
  await win.getByTestId(`split-dir-right-${paneId}`).click()
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })

  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  for (const d of dirs) {
    await expect(win.getByTestId(`split-dir-${d}-${paneId}`)).toBeEnabled()
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-009 — REQ-006/REQ-004: kind selector shows all three options with Terminal selected by
// default; the compass directions and the kind options are present on ONE surface simultaneously.
test('TEST-009 REQ-006 kind selector defaults to Terminal; dirs + kinds shown together', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-kind-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()

  // Three kind options + four directions on the same popover (no intermediate step).
  await expect(win.getByTestId(`split-kind-terminal-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-kind-editor-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-kind-explorer-${paneId}`)).toBeVisible()
  await expect(win.getByTestId(`split-dir-right-${paneId}`)).toBeVisible()

  // Terminal is the initially selected kind; the others are not (aria-checked / aria-pressed
  // reflects selection per REQ-006/REQ-011).
  const selected = async (id: string) => {
    const el = win.getByTestId(id)
    const checked = await el.getAttribute('aria-checked')
    const pressed = await el.getAttribute('aria-pressed')
    return checked === 'true' || pressed === 'true'
  }
  expect(await selected(`split-kind-terminal-${paneId}`)).toBe(true)
  expect(await selected(`split-kind-editor-${paneId}`)).toBe(false)
  expect(await selected(`split-kind-explorer-${paneId}`)).toBe(false)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-010 — REQ-006: Explorer is gated on cwd. A seeded editor pane has no cwd → Explorer disabled.
// A terminal pane, once its shell reports a cwd, enables Explorer.
test('TEST-010 REQ-006 Explorer disabled without cwd, enabled once a cwd exists', async () => {
  test.setTimeout(60_000)

  // (a) editor pane — never has a cwd → Explorer disabled.
  const userData = mkdtempSync(join(tmpdir(), 'termh-split-nocwd-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-split-proj-'))
  const file = join(proj, 'x.ts'); writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')
  const app1 = await launch(userData)
  const win1 = await app1.firstWindow()
  await expect(win1.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await win1.getByTestId('split-p1').click()
  await expect(win1.getByTestId('split-menu')).toBeVisible()
  await expect(win1.getByTestId('split-kind-explorer-p1')).toBeDisabled()
  await expect(win1.getByTestId('split-kind-terminal-p1')).toBeEnabled()
  const pid1 = app1.process().pid; await app1.close().catch(() => {}); killTree(pid1)

  // (b) terminal pane — once the shell reports a cwd, Explorer becomes enabled.
  const { app, win, paneId } = await launchWithTerminal('termh-split-cwd-')
  await expect(win.locator(`[data-testid="tile-${paneId}"]`)).not.toHaveAttribute('data-cwd', '', { timeout: 15_000 })
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await expect(win.getByTestId(`split-kind-explorer-${paneId}`)).toBeEnabled()
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-011 — REQ-007: pick a kind (Editor) then activate a direction (right) → 2 tiles, exactly one
// editor pane and still exactly one terminal (no extra shell spawned by the split).
test('TEST-011 REQ-007 select Editor kind + activate right commits one editor pane', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-editor-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId(`split-kind-editor-${paneId}`).click()
  await win.getByTestId(`split-dir-right-${paneId}`).click()

  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  await expect(win.locator('[data-testid^="editor-"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-012 — REQ-007/REQ-009: a `left` split inserts the new pane BEFORE the source. With kind =
// Terminal, activating `split-dir-left` yields 2 tiles where the NEW terminal is ordered before the
// original (the observable before/after-insertion difference).
test('TEST-012 REQ-007 left split orders the new pane before the source', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-left-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.getByTestId(`split-kind-terminal-${paneId}`).click()
  await win.getByTestId(`split-dir-left-${paneId}`).click()

  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })
  // DOM tile order reflects the layout tree's first→second order. A `before` split puts the NEW pane
  // first, so the source pane is the SECOND tile (index 1), not the first.
  const ids = await win.locator('[data-testid^="tile-"]').evaluateAll(
    els => els.map(e => ((e as { getAttribute(name: string): string | null }).getAttribute('data-testid') || '').replace('tile-', ''))
  )
  expect(ids).toHaveLength(2)
  expect(ids[1]).toBe(paneId)
  expect(ids[0]).not.toBe(paneId)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-013 — REQ-010: keyboard open + default highlight = right + Enter commits. Focus the split
// button, press Enter to open; the right target is focused/highlighted; press Enter to commit an
// after/right split → 2 tiles, committed entirely by keyboard.
test('TEST-013 REQ-010 keyboard opens popover, right is highlighted, Enter commits', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-kbd-')
  await win.getByTestId(`split-${paneId}`).focus()
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('split-menu')).toBeVisible()
  // Default highlight is the right direction (focus moves into the compass onto it).
  await expect(win.getByTestId(`split-dir-right-${paneId}`)).toBeFocused()
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-014 — REQ-010: arrow keys move the highlight. From the default right, ArrowDown highlights the
// down target; Enter commits that direction → 2 tiles.
test('TEST-014 REQ-010 arrow keys move the highlight before Enter commits', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-arrow-')
  await win.getByTestId(`split-${paneId}`).focus()
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.keyboard.press('ArrowDown')
  await expect(win.getByTestId(`split-dir-down-${paneId}`)).toBeFocused()
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-015 — REQ-010: Esc dismisses the popover without splitting (tile count unchanged).
test('TEST-015 REQ-010 Esc closes the popover without committing', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-esc-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('split-menu')).toHaveCount(0)
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(1)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-016 — REQ-011: ARIA. Each direction target exposes an accessible name naming its direction;
// each kind option exposes its name and a checked/pressed state.
test('TEST-016 REQ-011 directions and kinds expose accessible names + selected state', async () => {
  test.setTimeout(45_000)
  const { app, win, paneId } = await launchWithTerminal('termh-split-aria-')
  await win.getByTestId(`split-${paneId}`).click()
  await expect(win.getByTestId('split-menu')).toBeVisible()

  // Direction targets: non-empty accessible name naming the direction.
  for (const [d, word] of [['up', 'up'], ['left', 'left'], ['right', 'right'], ['down', 'down']] as const) {
    const name = (await win.getByTestId(`split-dir-${d}-${paneId}`).getAttribute('aria-label')) || ''
    expect(name.toLowerCase()).toContain(word)
  }
  // Kind options: accessible name + a selected-state attribute (aria-checked or aria-pressed).
  for (const [k, label] of [['terminal', 'Terminal'], ['editor', 'Editor'], ['explorer', 'Explorer']] as const) {
    const el = win.getByTestId(`split-kind-${k}-${paneId}`)
    await expect(el).toContainText(label)
    const checked = await el.getAttribute('aria-checked')
    const pressed = await el.getAttribute('aria-pressed')
    expect(checked !== null || pressed !== null).toBe(true)
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-017 — REQ-012: the new toolbar/popover chrome is paint-only and must not perturb the
// editor-tabs/Monaco box. Open the new popover over an editor pane (its split-kind targets exist
// under the new contract — RED today), close it, and confirm Monaco model-switching still works.
test('TEST-017 REQ-012 new chrome does not perturb Monaco model switching', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-split-paint-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-split-paintproj-'))
  const a = join(proj, 'a.ts'); const b = join(proj, 'b.ts')
  writeFileSync(a, 'AAA\n', 'utf8'); writeFileSync(b, 'BBB\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [a, b], activePath: a } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })

  // Open the new combined popover (asserts the new kind contract exists), then dismiss it.
  await win.getByTestId('split-p1').click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  await expect(win.getByTestId('split-kind-terminal-p1')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('split-menu')).toHaveCount(0)

  // Monaco still switches models cleanly (no .view-lines / FitAddon wedge from a sibling-box change).
  await win.getByTestId('tab-b.ts').click()
  await expect(win.locator('.view-lines')).toContainText('BBB', { timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
