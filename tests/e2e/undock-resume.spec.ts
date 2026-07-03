import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

/** Find the torn-off floating window (by its header — the transient drag ghost also appears in
 *  app.windows(), so "any window ≠ main" can grab the wrong page). Mirrors undock.spec.ts. */
async function findFloating(app: ElectronApplication, main: Page): Promise<Page> {
  for (let tries = 0; tries < 100; tries++) {
    for (const w of app.windows()) {
      if (w === main || w.isClosed()) continue
      const n = await w.getByTestId('floating-header').count().catch(() => 0)
      if (n > 0) return w
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('no floating window with a floating-header appeared')
}

/** Drag the first tab of `win` straight down off the strip → main undocks it into a new window. */
async function tearOffFirstTab(win: Page): Promise<void> {
  const tab = win.getByTestId('workspace-tabs').locator('[data-tab-id]').first()
  const box = await tab.boundingBox()
  if (!box) throw new Error('no tab to tear off')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  await win.mouse.move(cx, cy + 500, { steps: 12 })   // well past the 6px threshold and the 36px strip
  await win.mouse.up()
}

// Regression for the "undock re-types `claude --resume`" bug: a multi-window handoff re-adopts a
// still-running PTY, but the destination window is a DIFFERENT renderer — its snapshot arrives via
// main's transit buffer, not the renderer stash the auto-resume gate used to key off — so the pane
// looked like a fresh spawn of a resumeAi:'claude' config and typed `claude --resume` into the live
// agent. The gate now also consumes main's authoritative adopted-live-pty answer from pty:spawn.
// Observed like minimize-resume.spec.ts: the stub Claude waits on a line of input (`set /p`); a
// spurious resume would satisfy that read, the stub exits, the AI chip clears. With the fix, the
// chip survives the tear-off.
test('undocking a workspace does NOT re-issue `claude --resume` into a live Claude pane', async () => {
  test.setTimeout(180_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-undock-resume-'))
  const stubDir = mkdtempSync(join(tmpdir(), 'termh-undock-stub-'))
  // Stays "busy" briefly (so the busy-gated poll detects it), then waits on input — staying alive at
  // the prompt so a spurious resume would feed it a line and make it exit. Ignores its args, so the
  // legit `claude --resume` on relaunch runs it just the same.
  const stub = join(stubDir, 'claude.cmd')
  writeFileSync(stub,
    '@echo off\r\n' +
    'echo Claude Code starting\r\n' +
    'ping -n 6 127.0.0.1 >nul\r\n' +
    'echo Claude Code ready\r\n' +
    'set /p x=\r\n', 'utf8')
  const env = { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}` }
  const launch = (): Promise<ElectronApplication> => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`], env
  })

  // --- Session 1: run Claude so the pane is stamped `resumeAi: 'claude'` and persisted on close. ---
  let app = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('claude')          // on PATH (stubDir) -> process tree has claude.cmd
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toContainText('Claude', { timeout: 25_000 })
  await app.close().catch(() => {})           // persists workspace with resumeAi: 'claude'

  // --- Session 2: relaunch. The fresh shell auto-resumes Claude (the LEGIT path — also proves the
  //     stamped config + stub react to a resume), then we tear the workspace off into its own window
  //     and assert the live session is not re-resumed by the destination pane's re-adoption. ---
  app = await launch()
  const main = await app.firstWindow()
  await expect(main.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await expect(main.locator('[data-testid^="proc-chip-"]').first()).toContainText('Claude', { timeout: 30_000 })

  // A second workspace so the main window keeps a tab after the tear-off; back to WS1 to tear it.
  await main.getByTestId('new-workspace').click()
  await expect(main.getByTestId('add-first-terminal')).toBeVisible({ timeout: 15_000 })
  await main.getByTestId('workspace-tabs').locator('[data-tab-id]').first().click()
  await expect(main.locator('[data-testid^="proc-chip-"]').first()).toContainText('Claude', { timeout: 15_000 })

  await tearOffFirstTab(main)
  const floating = await findFloating(app, main)
  await expect(floating.getByTestId('floating-header')).toBeVisible({ timeout: 15_000 })
  await expect(floating.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // The live Claude session must SURVIVE the handoff. With the bug, the destination pane types
  // `claude --resume` after its 700ms output-quiet window, feeding the stub's `set /p` — it exits
  // and the chip clears. Wait well past that window before asserting.
  await floating.waitForTimeout(5_000)
  await expect(floating.locator('[data-testid^="proc-chip-"]').first()).toContainText('Claude')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
