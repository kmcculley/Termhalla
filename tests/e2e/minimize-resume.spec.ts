import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

// Regression for the "restore re-types `claude --resume`" bug: minimize/restore (and any re-adoption
// of a live PTY) must NOT auto-type `claude --resume`, because Claude is still running and the command
// would land as a prompt into the live agent. We observe it indirectly but reliably: the stub Claude
// sits waiting on a line of input (`set /p`); a spurious `claude --resume\r` would satisfy that read
// and the stub would EXIT (the AI chip clears). With the fix, the chip survives minimize+restore.
test('minimize then restore does NOT re-issue `claude --resume` into a live Claude pane', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-min-resume-'))
  const stubDir = mkdtempSync(join(tmpdir(), 'termh-resume-stub-'))
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

  // --- Session 2: relaunch. The fresh shell auto-resumes Claude (the LEGIT path), then we
  //     minimize + restore and assert the live session is not re-resumed out from under us. ---
  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  // The auto-resume fires `claude --resume` into the freshly-spawned shell -> stub runs -> detected.
  const chip = win.locator('[data-testid^="proc-chip-"]').first()
  await expect(chip).toContainText('Claude', { timeout: 30_000 })

  // Grab the pane id to drive its minimize button + tray chip.
  const paneId = await win.locator('[data-testid^="terminal-"]').first()
    .evaluate(el => (el.getAttribute('data-testid') || '').replace('terminal-', ''))
  expect(paneId).toBeTruthy()

  // Minimize, then restore.
  await win.getByTestId(`min-${paneId}`).click()
  await expect(win.getByTestId(`min-chip-${paneId}`)).toBeVisible({ timeout: 10_000 })
  await win.getByTestId(`min-chip-${paneId}`).click()
  await expect(win.getByTestId(`tile-${paneId}`)).toBeVisible({ timeout: 10_000 })

  // The live Claude session must SURVIVE the round-trip. With the bug, the restore (and the minimize)
  // would type `claude --resume` into the stub's `set /p`, making it exit and clearing the chip. Wait
  // well past the auto-resume quiet window (700ms) to be sure no spurious command was issued.
  await win.waitForTimeout(3_000)
  await expect(chip).toContainText('Claude')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
