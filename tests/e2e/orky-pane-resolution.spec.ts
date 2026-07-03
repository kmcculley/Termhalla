// 0015-orky-contract-v2-refresh — phase 4 (tests), REQ-110 / TASK-112 (rendered half).
// Playwright-for-Electron against out/ (run `npm run build` first). The structural half of REQ-110
// is pinned node-side in tests/renderer/orky-pane-resolution-structure.test.ts (TEST-715); this
// suite proves the RENDERED vectors the spec's acceptance names:
//   TEST-716 — (a)+(b): a resolved finding with a non-null resolution renders the dim
//              `— resolution: <resolution>` affix on its orky-pane-finding row, with resolvedBy and
//              a formatted resolvedAt observable in the row's text or title; a MIXED-CASE 'Resolved'
//              status (the producer's case-insensitive finding_normalization contract) shows the
//              affix too.
//   TEST-717 — (c): an OPEN finding and a resolved finding with resolution null render their rows
//              exactly as today — NO 'resolution:' substring in text or title, content identical to
//              the pre-change rendering (id severity status claim).
//
// AMENDED 2026-07-03 — ESC-001 descent, tests-phase re-entry (TASK-116), amended REQ-110:
//   TEST-723 — amended acceptance (a): whenever the affix renders, the row's `title` attribute
//              MIRRORS the full row text — the claim PLUS the resolution details (resolution text,
//              resolvedBy, formatted resolvedAt where carried) — so a clipped (nowrap/ellipsis) row
//              stays reachable. The `by <resolvedBy>` LABEL is a MAY and is deliberately NOT pinned.
//   TEST-724 — new acceptance (d): a resolved finding with resolution '' (EMPTY string), even with
//              non-null resolvedBy/resolvedAt, renders NO 'resolution:' substring anywhere — no
//              dangling `— resolution:` label, no orphaned resolvedBy/resolvedAt parts — identical
//              to the null-resolution no-affix rendering.
//
// Locators per CONV-056: testid + attribute filters (data-finding-id), exact toHaveText pins for the
// unchanged rows — no substring hasText locators.
//
// Runs RED against the shipped OrkyPane (no affix is rendered on any finding row). Descent RED
// (against the first-pass TASK-112 code): TEST-716/717 are GREEN, but TEST-723 fails (the row title
// is still the bare claim) and TEST-724 fails (the guard is only `!== null`, so the '' vector
// renders a dangling `— resolution:` + the resolvedBy/resolvedAt parts).
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

// formatOrkyInstant is deterministic UTC ('YYYY-MM-DD HH:MM:SS UTC'), so the formatted resolvedAt
// for 2026-07-01T00:00:00.000Z is a fixed literal — no import from src needed here.
const RESOLVED_AT_ISO = '2026-07-01T00:00:00.000Z'
const RESOLVED_AT_FORMATTED = '2026-07-01 00:00:00 UTC'

/** A synthetic .orky/ project whose ONE feature carries the five REQ-110 finding vectors. */
function seedResolutionProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'termh-orkyres-'))
  const dir = join(proj, '.orky', 'features', 'res-feature')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    feature: 'res-feature', phase: 'review',
    gates: { brainstorm: { passed: true, at: '2026-06-30T00:00:00.000Z' } },
    escalations: []
  }), 'utf8')
  writeFileSync(join(dir, 'findings.json'), JSON.stringify([
    // (a) lowercase resolved + full resolution details
    { id: 'F-LOWER', lens: 'quality', claim: 'guard was wrong', severity: 'HIGH', status: 'resolved',
      resolution: 'rewrote the guard', resolvedBy: 'kevin', resolvedAt: RESOLVED_AT_ISO },
    // (b) MIXED-CASE status — the case-insensitive comparison contract
    { id: 'F-MIXED', lens: 'quality', claim: 'mixed case entry', severity: 'LOW', status: 'Resolved',
      resolution: 'case-folded fix' },
    // (c1) open finding — must render exactly as today
    { id: 'F-OPEN', lens: 'quality', claim: 'a medium note', severity: 'MEDIUM', status: 'open' },
    // (c2) resolved but resolution null-equivalent (absent) — no affix, never '— resolution: null'
    { id: 'F-BARE', lens: 'quality', claim: 'resolved but bare', severity: 'LOW', status: 'resolved' },
    // (d) resolved with resolution EMPTY STRING but non-null resolvedBy/resolvedAt (amended
    //     REQ-110, ESC-001): the mapper keeps '' verbatim — the DISPLAY guard must exclude it, so
    //     no affix, no dangling label, no orphaned resolvedBy/resolvedAt parts
    { id: 'F-EMPTY', lens: 'quality', claim: 'resolved but empty', severity: 'LOW', status: 'resolved',
      resolution: '', resolvedBy: 'kevin', resolvedAt: RESOLVED_AT_ISO }
  ]), 'utf8')
  return proj
}

function seedRegistry(userData: string, roots: string[]): void {
  writeFileSync(join(userData, 'orky-registry.json'), JSON.stringify({ version: 1, roots }), 'utf8')
}

type Win = Awaited<ReturnType<ElectronApplication['firstWindow']>>

/** Palette → picker → bound pane → expand the res-feature row; returns the pane locator. */
async function openExpandedPane(win: Win, proj: string) {
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new orky')
  await expect(win.getByTestId('palette-item-0')).toContainText('New Orky pane', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  await expect(win.getByTestId('orky-root-picker')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  const pane = win.locator(`[data-testid="orky-pane"][data-root="${csspath(proj)}"]`)
  await expect(pane).toBeVisible({ timeout: 20_000 })
  const row = pane.locator('[data-testid="orky-pane-feature"][data-feature="res-feature"]')
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.locator('button[aria-label="Toggle details for res-feature"]').click()
  await expect(pane.locator('[data-testid="orky-pane-finding"]')).toHaveCount(5, { timeout: 10_000 })
  return pane
}

/** A finding row's full observable surface: rendered text + the row's title attribute. */
async function rowSurface(pane: ReturnType<Win['locator']>, findingId: string): Promise<{ text: string; title: string }> {
  const row = pane.locator(`[data-testid="orky-pane-finding"][data-finding-id="${findingId}"]`)
  const text = (await row.textContent()) ?? ''
  const title = (await row.getAttribute('title')) ?? ''
  return { text, title }
}

test('TEST-716 REQ-110 a resolved finding renders the `— resolution:` affix with resolvedBy + formatted resolvedAt observable; a MIXED-CASE Resolved status shows the affix too', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-or1-'))
  const proj = seedResolutionProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  const pane = await openExpandedPane(win, proj)

  // (a) lowercase resolved + resolution → the dim affix, verbatim resolution text
  const lower = pane.locator('[data-testid="orky-pane-finding"][data-finding-id="F-LOWER"]')
  await expect(lower).toContainText('— resolution: rewrote the guard')
  // resolvedBy and the FORMATTED resolvedAt are observable on the SAME row — inline in the affix
  // or via the row's title (implementer's choice, but one of the two must carry them)
  const surface = await rowSurface(pane, 'F-LOWER')
  const combined = `${surface.text} ${surface.title}`
  expect(combined, 'resolvedBy must be observable on the row (text or title)').toContain('kevin')
  expect(combined, 'the formatted resolvedAt must be observable on the row (text or title)')
    .toContain(RESOLVED_AT_FORMATTED)

  // (b) mixed-case 'Resolved' — compared case-insensitively, the affix still renders
  const mixed = pane.locator('[data-testid="orky-pane-finding"][data-finding-id="F-MIXED"]')
  await expect(mixed).toContainText('— resolution: case-folded fix')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('TEST-717 REQ-110 an OPEN finding and a resolved finding WITHOUT a resolution render exactly as today — no `resolution:` substring anywhere on the row, content identical to the pre-change rendering', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-or2-'))
  const proj = seedResolutionProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  const pane = await openExpandedPane(win, proj)

  // (c1) the open row: byte-identical content to today's rendering — id severity status claim
  const open = pane.locator('[data-testid="orky-pane-finding"][data-finding-id="F-OPEN"]')
  await expect(open).toHaveText('F-OPEN MEDIUM open a medium note')
  // (c2) resolved-with-null-resolution: no affix, and NEVER a literal '— resolution: null'
  const bare = pane.locator('[data-testid="orky-pane-finding"][data-finding-id="F-BARE"]')
  await expect(bare).toHaveText('F-BARE LOW resolved resolved but bare')
  for (const id of ['F-OPEN', 'F-BARE']) {
    const { text, title } = await rowSurface(pane, id)
    expect(text, `${id}'s row text must carry no resolution affix`).not.toContain('resolution:')
    expect(title, `${id}'s row title must carry no resolution affix`).not.toContain('resolution:')
  }

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test("TEST-723 REQ-110 (amended, ESC-001) whenever the affix renders, the row's TITLE mirrors the full row text — the claim PLUS the resolution details — so a clipped row stays reachable", async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-or3-'))
  const proj = seedResolutionProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  const pane = await openExpandedPane(win, proj)

  // full vector: the title carries the claim AND the resolution text AND resolvedBy AND the
  // formatted resolvedAt (amended acceptance (a) — the non-clipped surface). The `by <resolvedBy>`
  // LABEL is a MAY and is deliberately not pinned; only the details' PRESENCE in the title is.
  const lower = await rowSurface(pane, 'F-LOWER')
  expect(lower.title, "the title must still carry the claim (the row's existing idiom)").toContain('guard was wrong')
  expect(lower.title, 'the title must carry the resolution text').toContain('rewrote the guard')
  expect(lower.title, 'the title must carry resolvedBy').toContain('kevin')
  expect(lower.title, 'the title must carry the formatted resolvedAt').toContain(RESOLVED_AT_FORMATTED)

  // affixed row WITHOUT resolvedBy/resolvedAt: the title still mirrors claim + its (shorter) affix
  const mixed = await rowSurface(pane, 'F-MIXED')
  expect(mixed.title, "the title must still carry the claim (the row's existing idiom)").toContain('mixed case entry')
  expect(mixed.title, 'the title must carry the resolution text').toContain('case-folded fix')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test("TEST-724 REQ-110 (amended, ESC-001) a resolved finding with resolution '' — even with non-null resolvedBy/resolvedAt — renders NO resolution affix and no dangling parts, identical to the null-resolution rendering", async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-or4-'))
  const proj = seedResolutionProject()
  seedRegistry(userData, [proj])
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('add-first-terminal')).toBeVisible({ timeout: 20_000 })
  const pane = await openExpandedPane(win, proj)

  // exact content pin — byte-identical to the no-affix rendering (id severity status claim),
  // matching TEST-717's F-BARE precedent
  const empty = pane.locator('[data-testid="orky-pane-finding"][data-finding-id="F-EMPTY"]')
  await expect(empty).toHaveText('F-EMPTY LOW resolved resolved but empty')
  const { text, title } = await rowSurface(pane, 'F-EMPTY')
  // no dangling `— resolution:` label anywhere on the row's observable surface…
  expect(text, "F-EMPTY's row text must carry no resolution affix").not.toContain('resolution:')
  expect(title, "F-EMPTY's row title must carry no resolution affix").not.toContain('resolution:')
  // …and no orphaned resolvedBy/resolvedAt parts rendered without their resolution
  const combined = `${text} ${title}`
  expect(combined, 'the resolvedBy value must not leak onto a no-affix row').not.toContain('kevin')
  expect(combined, 'the formatted resolvedAt must not leak onto a no-affix row').not.toContain(RESOLVED_AT_FORMATTED)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
