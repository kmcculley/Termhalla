import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

test('broadcast: Shift+Enter sends, and quick-key buttons are present', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.getByTestId('broadcast-button').click()
  await expect(win.getByTestId('broadcast-key-ctrl-c')).toBeEnabled()
  // a11y: the dialog card exposes a dialog role + label
  await expect(win.locator('[aria-label="Broadcast to all terminals"][role="dialog"]')).toHaveCount(1)
  await win.getByTestId('broadcast-text').fill('echo pol-shift-7788')
  await win.getByTestId('broadcast-text').press('Shift+Enter')

  const rows = win.locator('.xterm-rows')
  await expect(rows.nth(0)).toContainText('pol-shift-7788', { timeout: 15_000 })
  await expect(rows.nth(1)).toContainText('pol-shift-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('schedule dialog spans the full window (not clipped by an adjacent terminal)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.locator('[data-testid^="schedule-chip-"]').first().click()
  const dialog = win.getByTestId('schedule-dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  const innerWidth = await win.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  // Portalled to <body>, the fixed inset:0 overlay covers the whole viewport (≈ full width),
  // rather than being confined to one mosaic tile (~half width).
  expect(box!.width).toBeGreaterThan(innerWidth * 0.9)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('rename: the existing workspace name is selected on focus', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.locator('[data-testid^="tab-"]').first().click({ button: 'right' })
  await win.getByTestId('ws-menu-rename').click()
  const input = win.locator('[data-testid^="ws-rename-"]')
  await expect(input).toBeFocused()
  const fullySelected = await input.evaluate(el => {
    const i = el as unknown as { value: string; selectionStart: number | null; selectionEnd: number | null }
    return i.value.length > 0 && i.selectionStart === 0 && i.selectionEnd === i.value.length
  })
  expect(fullySelected).toBe(true)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('modal card has a drop shadow and --sel-bg resolves to an accent colour (not #094771)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol4-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-pol4-proj-'))
  const file = join(proj, 'a.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })

  // Open the command palette (global Ctrl+K) and assert its card carries a shadow.
  await win.keyboard.press('Control+KeyK')
  const card = win.getByTestId('command-palette')
  await expect(card).toBeVisible({ timeout: 10_000 })
  // The tests tsconfig has no DOM lib (Node target), so reach DOM globals via globalThis,
  // matching the cast pattern already used elsewhere in this file.
  const shadow = await card.evaluate(el => {
    const g = globalThis as unknown as { getComputedStyle(e: unknown): { boxShadow: string } }
    return g.getComputedStyle(el).boxShadow
  })
  expect(shadow).not.toBe('none')
  expect(shadow.length).toBeGreaterThan(0)

  // color-mix() must actually resolve in this engine: a probe painted with var(--sel-bg)
  // should compute to a visible colour that tracks the accent — not the old literal,
  // not fully transparent.
  const selBg = await win.evaluate(() => {
    const g = globalThis as unknown as {
      document: { createElement(t: string): { style: { background: string }; remove(): void }; body: { appendChild(e: unknown): void } }
      getComputedStyle(e: unknown): { backgroundColor: string }
    }
    const el = g.document.createElement('div')
    el.style.background = 'var(--sel-bg)'
    g.document.body.appendChild(el)
    const c = g.getComputedStyle(el).backgroundColor
    el.remove()
    return c
  })
  expect(selBg).not.toBe('rgb(9, 71, 113)')   // the retired #094771
  expect(selBg).not.toBe('rgba(0, 0, 0, 0)')  // and it is NOT transparent
  expect(selBg).not.toBe('transparent')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('editor still renders the correct file after a tab switch (Monaco-layout regression)', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol5-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-pol5-proj-'))
  const a = join(proj, 'a.ts'); const b = join(proj, 'b.ts')
  writeFileSync(a, 'AAA\n', 'utf8'); writeFileSync(b, 'BBB\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [a, b], activePath: a } }], 'p1')

  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  // Switch in both directions. The .mosaic-window-title ellipsis rule is a toolbar
  // sibling of Monaco; if it perturbed layout measurement, .view-lines would stay
  // stuck on the previous file rather than re-rendering the switched-to model.
  await win.getByTestId('tab-b.ts').click()
  await expect(win.locator('.view-lines')).toContainText('BBB', { timeout: 15_000 })
  await win.getByTestId('tab-a.ts').click()
  await expect(win.locator('.view-lines')).toContainText('AAA', { timeout: 15_000 })
  expect(readFileSync(a, 'utf8')).toBe('AAA\n')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('toast appears when saving a workspace template', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol6-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('My Tpl')
  await win.getByTestId('tpl-save').click()
  await expect(win.getByTestId('toast')).toContainText('Template saved', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('explorer context menu renames and trashes a file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol7-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-pol7-proj-'))
  const f = join(proj, 'old.txt'); writeFileSync(f, 'x', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'explorer', root: proj } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('entry-old.txt')).toBeVisible({ timeout: 15_000 })

  // rename old.txt -> new.txt
  await win.getByTestId('entry-old.txt').click({ button: 'right' })
  await win.getByTestId('explorer-rename').click()
  const input = win.getByTestId('rename-old.txt')
  await input.fill('new.txt')
  await input.press('Enter')
  await expect(win.getByTestId('entry-new.txt')).toBeVisible({ timeout: 10_000 })
  expect(existsSync(join(proj, 'new.txt'))).toBe(true)
  expect(existsSync(f)).toBe(false)

  // delete new.txt (auto-accept the confirm)
  await win.evaluate(() => { (globalThis as unknown as { confirm: () => boolean }).confirm = () => true })
  await win.getByTestId('entry-new.txt').click({ button: 'right' })
  await win.getByTestId('explorer-delete').click()
  await expect(win.getByTestId('entry-new.txt')).toHaveCount(0, { timeout: 10_000 })
  expect(existsSync(join(proj, 'new.txt'))).toBe(false)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('env manager autofocuses the passphrase input', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol8-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('settings-button').click()
  await win.getByTestId('settings-nav-environment').click()
  await expect(win.getByTestId('env-passphrase')).toBeFocused({ timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
