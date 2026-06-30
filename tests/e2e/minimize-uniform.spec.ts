// FROZEN e2e suite — feature 0003-pane-minimize-restore (phase 4 / REQ-012).
// Minimize/restore must behave identically for Terminal / Editor / Explorer. This seeds an Editor
// pane (with an unsaved draft) and an Explorer pane and proves both minimize/restore with state
// intact, and that the minimize affordance renders on non-terminal kinds (not terminal-gated).
// Runs RED until the feature ships. Requires `npm run build` first.
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

// TEST-030 — REQ-012: Editor + Explorer minimize/restore with state intact; affordance on all kinds.
test('TEST-030 REQ-012 editor (draft) and explorer minimize/restore with state intact', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-min-uniform-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-min-uniform-proj-'))
  const file = join(proj, 'note.ts'); writeFileSync(file, 'const a = 1\n', 'utf8')
  // Two seeded panes: an editor (p1) and an explorer (p2), side by side.
  seedWorkspace(
    userData,
    [
      { paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } },
      { paneId: 'p2', config: { kind: 'explorer', root: proj } }
    ],
    { direction: 'row', first: 'p1', second: 'p2' }
  )
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId('entry-note.ts')).toBeVisible({ timeout: 15_000 })

  // Type an UNSAVED draft into the editor.
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// MIN-DRAFT-5555\n')
  await expect(win.locator('.view-lines')).toContainText('MIN-DRAFT-5555', { timeout: 10_000 })

  // The minimize affordance renders on BOTH non-terminal kinds (not terminal-gated).
  await expect(win.getByTestId('min-p1')).toHaveCount(1)
  await expect(win.getByTestId('min-p2')).toHaveCount(1)

  // Minimize the editor, then restore it — the unsaved draft is intact (flushed-not-deleted, C3).
  await win.getByTestId('min-p1').click()
  await expect(win.getByTestId('tile-p1')).toHaveCount(0)
  await expect(win.getByTestId('min-chip-p1')).toBeVisible({ timeout: 10_000 })
  await win.getByTestId('min-chip-p1').click()
  await expect(win.getByTestId('tile-p1')).toBeVisible({ timeout: 10_000 })
  await expect(win.locator('.view-lines')).toContainText('MIN-DRAFT-5555', { timeout: 10_000 })

  // Minimize/restore the explorer — its root/entries are preserved (kept-mounted).
  await win.getByTestId('min-p2').click()
  await expect(win.getByTestId('tile-p2')).toHaveCount(0)
  await win.getByTestId('min-chip-p2').click()
  await expect(win.getByTestId('tile-p2')).toBeVisible({ timeout: 10_000 })
  await expect(win.getByTestId('entry-note.ts')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
