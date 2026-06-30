// FROZEN e2e suite (Loop-back 2 / from review) — feature 0003-pane-minimize-restore.
// These specs pin the iteration-2 hardening findings that the shallow iteration-1 e2es could not
// catch. They run RED until the Option-A hardening (TASK-011..018) ships. Requires `npm run build`
// first (runs against out/), workers:1 (single Electron instance — see CLAUDE.md).
//
//   TEST-036 — FINDING-CODEX-001 (REQ-003): output emitted DURING the minimize<->restore unmount/
//              remount GAP is buffered (same-window transit) and is NOT dropped from scrollback.
//   TEST-037 — FINDING-DA-002 (REQ-003+REQ-005): a minimized pane in a MULTI-tile workspace still
//              accumulates output AND still surfaces needs-input on its chip (host geometry / repaint).
//   TEST-038 — FINDING-DA-001 (REQ-012): an Explorer pane with a SUBFOLDER expanded keeps it expanded
//              across minimize/restore (strengthens the shallow TEST-030 top-level-only check).
//   TEST-041 — FINDING-SEC-001 (REQ-010): toggle-maximize on a currently-minimized pane is a no-op —
//              the pane is never in both minimized AND maximized (the surviving pane stays visible).
//   TEST-043 — FINDING-QOL-001 (REQ-002+REQ-004): the tray strip does not swallow clicks between
//              chips — a point over the strip hit-tests through to the reflowed terminal beneath.
//   TEST-044 — FINDING-QUAL-002 (REQ-013): the context-menu Minimize item carries a registry-derived
//              chord title that tracks a rebind (not absent / not hard-coded).
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'
import { splitSecondTerminal } from './split-helper'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

async function tileIds(win: Page): Promise<string[]> {
  return win.locator('[data-testid^="tile-"]').evaluateAll(els =>
    els.map(e => ((e as { getAttribute(n: string): string | null }).getAttribute('data-testid') || '').replace('tile-', '')))
}
async function launchWithTerminal(prefix: string): Promise<{ app: ElectronApplication; win: Page; paneId: string }> {
  const userData = mkdtempSync(join(tmpdir(), prefix))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  const [paneId] = await tileIds(win)
  return { app, win, paneId }
}
async function launchTwoTerminals(prefix: string): Promise<{ app: ElectronApplication; win: Page; ids: string[] }> {
  const r = await launchWithTerminal(prefix)
  await splitSecondTerminal(r.win)
  await expect(r.win.locator('[data-testid^="tile-"]')).toHaveCount(2, { timeout: 15_000 })
  return { app: r.app, win: r.win, ids: await tileIds(r.win) }
}

// TEST-036 — REQ-003 / CODEX-001 (the core fix): a terminal streams a CONTIGUOUS counter while the
// pane is toggled minimize->restore several times, so tokens land inside the unmount/remount gap.
// If the same-window transit buffer is NOT armed (iteration 1), gap-window `pty:data` is dropped and
// a counter value goes missing. The fix buffers the gap bytes and replays them on re-adoption, so the
// observed counter is contiguous (no skipped value) — proving no output was lost across the transition.
test('TEST-036 REQ-003 output emitted during the minimize/restore transition is buffered, not dropped', async () => {
  test.setTimeout(90_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-transit-')
  await win.locator('.xterm-screen').first().click()
  // A modest contiguous stream (fits a single full-body terminal's viewport so late values stay in DOM).
  await win.keyboard.type('foreach ($i in 1..12) { Write-Host "SEQ-$i-END"; Start-Sleep -Milliseconds 450 }')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('SEQ-2-END', { timeout: 15_000 })

  // Toggle minimize<->restore repeatedly WHILE the stream is mid-flight so tokens fall in the gap.
  for (let n = 0; n < 3; n++) {
    await win.getByTestId(`min-${paneId}`).click()
    await expect(win.getByTestId(`tile-${paneId}`)).toHaveCount(0)
    await win.waitForTimeout(700) // a couple of counter ticks elapse while off-layout / in transit
    await win.getByTestId(`min-chip-${paneId}`).click()
    await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })
    await win.waitForTimeout(400)
  }
  // Let the stream finish, then assert the counter is CONTIGUOUS across the toggled window — every
  // value 5..12 (the last, still-in-viewport rows, spanning the transition cycles) is present. A
  // dropped gap byte would manifest as a missing SEQ-n here.
  await expect(win.locator('.xterm-rows')).toContainText('SEQ-12-END', { timeout: 20_000 })
  for (let i = 5; i <= 12; i++) {
    await expect(win.locator('.xterm-rows')).toContainText(`SEQ-${i}-END`)
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-037 — REQ-003 + REQ-005 / DA-002 (multi-tile): minimize ONE of two side-by-side terminals.
// The minimized tile is remounted off-layout at a different size than its 50% tile — TASK-018 must
// size the host so the backgrounded pane still (a) accumulates delayed output and (b) surfaces
// needs-input on its chip, rather than wedging on the avoidable repaint. (TEST-026/033 only ever
// exercise the single-pane full-body geometry.)
test('TEST-037 REQ-003 a minimized pane in a multi-tile workspace still accumulates output and marks needs-input', async () => {
  test.setTimeout(90_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-multitile-')
  // Drive the LEFT pane: emit a delayed token, then a recognized input prompt (mirrors status.spec.ts).
  await win.getByTestId(`terminal-${ids[0]}`).locator('.xterm-screen').click()
  await win.keyboard.type('Start-Sleep -Seconds 3; Write-Host "MT-LIVE-4242-END"; Write-Host -NoNewline "Overwrite? [y/N] "; $null = [Console]::ReadLine()')
  await win.keyboard.press('Enter')

  // Minimize the left pane immediately (before the delayed token fires); the survivor reflows to 100%.
  await win.getByTestId(`min-${ids[0]}`).click()
  await expect(win.getByTestId(`tile-${ids[0]}`)).toHaveCount(0)
  await expect(win.getByTestId(`tile-${ids[1]}`)).toBeVisible({ timeout: 10_000 })

  // (b) needs-input is surfaced on the off-layout pane's chip even from a remounted/resized host.
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toHaveAttribute('data-needs-input', '1', { timeout: 25_000 })

  // (a) the delayed token, produced while minimized, is present after restore (output accumulated).
  await win.getByTestId(`min-chip-${ids[0]}`).click()
  await expect(win.getByTestId(`tile-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`terminal-${ids[0]}`).locator('.xterm-rows')).toContainText('MT-LIVE-4242-END', { timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-038 — REQ-012 / DA-001 (strengthens TEST-030): an Explorer pane holds its expanded-folder set
// in LOCAL React state, which a minimize remount (unmount in the tile -> mount in the host -> remount
// in the tile) discards unless the transit bridges it (TASK-012). Expand a SUBFOLDER, minimize,
// restore, and assert the subfolder is STILL expanded (its child is still rendered) — not collapsed
// back to root-only. The frozen TEST-030 only checks an always-present top-level entry and cannot see
// this; this test makes the "preserved like any kept-mounted pane" guarantee real.
test('TEST-038 REQ-012 an explorer subfolder stays expanded across minimize/restore', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-min-explorer-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-min-explorer-proj-'))
  const sub = join(proj, 'sub'); mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, 'child.ts'), 'export const c = 1\n', 'utf8')
  writeFileSync(join(proj, 'top.ts'), 'export const t = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'explorer', root: proj } }], 'p1')

  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('entry-sub')).toBeVisible({ timeout: 15_000 })

  // Expand the subfolder -> its child becomes visible (only rendered while `sub` is expanded).
  await win.getByTestId('entry-sub').click()
  await expect(win.getByTestId('entry-child.ts')).toBeVisible({ timeout: 10_000 })

  // Minimize (sole pane -> empty state), then restore from the chip.
  await win.getByTestId('min-p1').click()
  await expect(win.getByTestId('tile-p1')).toHaveCount(0)
  await expect(win.getByTestId('min-chip-p1')).toBeVisible({ timeout: 10_000 })
  await win.getByTestId('min-chip-p1').click()
  await expect(win.getByTestId('tile-p1')).toBeVisible({ timeout: 10_000 })

  // The subfolder is STILL expanded — its child is still rendered (state preserved across the remount).
  await expect(win.getByTestId('entry-child.ts')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-041 — REQ-010 / SEC-001 (runtime mutual exclusion): minimize the FOCUSED pane via the
// keybinding (focusedPaneId stays on it in iteration 1), then press toggle-maximize-pane. With the
// stale focus + no guard, toggleMaximize would set the minimized pane as maximized too — incoherent
// (in BOTH maps) and it hides the surviving visible pane. TASK-013 closes this (guard maximize against
// a minimized pane AND/OR refocus a visible pane after minimize), so the survivor stays visible and
// the minimized pane stays a tray chip (never both states). Default chords: minimize Ctrl+Shift+H,
// maximize Ctrl+Shift+M (src/shared/keybindings.ts).
test('TEST-041 REQ-010 toggle-maximize on a currently-minimized pane is a no-op (never both states)', async () => {
  test.setTimeout(60_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-mutex-')
  // Focus the LEFT pane, then minimize it with the keybinding (stale focus path SEC-001 exploits).
  await win.getByTestId(`terminal-${ids[0]}`).locator('.xterm-screen').click()
  await win.keyboard.press('Control+Shift+H')
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`tile-${ids[0]}`)).toHaveCount(0)

  // Now press toggle-maximize-pane with focus still (potentially) on the minimized pane.
  await win.keyboard.press('Control+Shift+M')

  // The surviving pane MUST stay visible (a maximize of the minimized pane would have hidden it), and
  // the minimized pane MUST remain a tray chip with no tile — i.e. it is never in both states.
  await expect(win.getByTestId(`tile-${ids[1]}`)).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId(`min-chip-${ids[0]}`)).toBeVisible()
  await expect(win.getByTestId(`tile-${ids[0]}`)).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-043 — REQ-002 + REQ-004 / QOL-001: the `.min-tray` container is a near-full-width, transparent,
// z-index:6 box pinned to the bottom of the workspace body. With pointer-events:auto it silently eats
// clicks across the whole bottom strip (even between chips) over the reflowed terminal beneath.
// TASK-016 makes the container pointer-events:none and the chips pointer-events:auto, so a point over
// the strip BUT NOT over a chip hit-tests THROUGH to the terminal. Asserted via elementFromPoint
// (hit-testing reflects pointer-events) — the resolved element is not the tray container.
test('TEST-043 REQ-002 a click in the tray strip between chips passes through to the terminal beneath', async () => {
  test.setTimeout(60_000)
  const { app, win, ids } = await launchTwoTerminals('termh-min-traypass-')
  // Minimize the LEFT pane: the RIGHT terminal reflows to fill the body; one chip sits at the strip's left.
  await win.getByTestId(`min-${ids[0]}`).click()
  await expect(win.getByTestId(`tile-${ids[1]}`)).toBeVisible({ timeout: 10_000 })
  const tray = win.locator('[data-testid^="min-tray-"]')
  await expect(tray).toHaveCount(1)
  const chip = win.getByTestId(`min-chip-${ids[0]}`)
  await expect(chip).toBeVisible()

  // Pick a point inside the tray strip but to the RIGHT of the chip (clearly not over any chip).
  const trayBox = (await tray.boundingBox())!
  const chipBox = (await chip.boundingBox())!
  const px = Math.round(Math.max(chipBox.x + chipBox.width + 40, trayBox.x + trayBox.width - 30))
  const py = Math.round(trayBox.y + trayBox.height / 2)

  // The element at that point must NOT be the tray container (it must pass through to what's beneath).
  const hitsTray = await win.evaluate(({ x, y }) => {
    const g = globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { closest(s: string): unknown } | null } }
    const el = g.document.elementFromPoint(x, y)
    return !!(el && el.closest('[data-testid^="min-tray-"]'))
  }, { x: px, y: py })
  expect(hitsTray).toBe(false)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

// TEST-044 — REQ-013 / QUAL-002: the context-menu Minimize item rendered no chord at all (no `title`),
// unlike the toolbar button which derives one via formatChord(resolveBindings(...)). TASK-017 adds a
// registry-derived title to `pane-menu-minimize`. This asserts (1) the menu item's title carries the
// SAME chord the toolbar shows (derived, not absent/hard-coded), and (2) after rebinding the command
// the menu item's title updates to the new chord (tracks the registry, REQ-013).
test('TEST-044 REQ-013 the context-menu Minimize item carries a registry-derived chord title that tracks a rebind', async () => {
  test.setTimeout(60_000)
  const { app, win, paneId } = await launchWithTerminal('termh-min-ctxchord-')

  // The toolbar tooltip already derives the chord; extract it as the registry's current value.
  const toolbarTitle = (await win.getByTestId(`min-${paneId}`).getAttribute('title')) || ''
  const chordMatch = toolbarTitle.match(/\(([^)]+)\)/)
  expect(chordMatch, `toolbar min title should expose a chord, got "${toolbarTitle}"`).toBeTruthy()
  const chord = chordMatch![1]

  // (1) The context-menu item's title carries that same chord (derived, not absent/hard-coded).
  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
  const menuItem = win.getByTestId('pane-menu-minimize')
  await expect(menuItem).toBeVisible()
  const menuTitle = (await menuItem.getAttribute('title')) || ''
  expect(menuTitle, `context-menu minimize title should contain the chord "${chord}"`).toContain(chord)
  await win.keyboard.press('Escape')

  // (2) Rebind toggle-minimize-pane to Ctrl+Shift+Y and assert the menu title now reflects the new chord.
  await win.keyboard.press('Control+Comma')
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await win.getByTestId('settings-nav-keybindings').click()
  await expect(win.getByTestId('settings-keybindings')).toBeVisible()
  await win.getByTestId('kb-change-toggle-minimize-pane').click()
  await expect(win.getByTestId('kb-chord-toggle-minimize-pane')).toHaveText('Press shortcut…')
  await win.keyboard.press('Control+Shift+Y') // a free chord that reaches the renderer on every platform
  await expect(win.getByTestId('kb-chord-toggle-minimize-pane')).toHaveText('Ctrl+Shift+Y')
  await win.getByTestId('settings-close').click()

  await win.getByTestId(`titlebar-${paneId}`).click({ button: 'right', position: { x: 30, y: 13 } })
  await expect(win.getByTestId('pane-menu-minimize')).toBeVisible()
  const rebound = (await win.getByTestId('pane-menu-minimize').getAttribute('title')) || ''
  expect(rebound).toContain('Ctrl+Shift+Y')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
