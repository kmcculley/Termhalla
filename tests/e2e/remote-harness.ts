// Shared plumbing for the remote-workspace e2e specs: launch the app with the fake-ssh transport
// (the TERMHALLA_E2E_REMOTE_SSH seam), create a remote workspace through the picker, and — the
// non-obvious part — tear DOWN in the right order.
//
// Teardown order is load-bearing (measured, not assumed): the per-workspace daemon is spawned
// DETACHED by the bridge, and on Windows it inherits every inheritable handle down the spawn
// chain (Electron → shim → bridge → daemon), including Playwright's own control pipes to the
// Electron process. While the daemon lives, Playwright's `app.close()` never sees EOF on those
// pipes and hangs the worker for its full teardown timeout — with ZERO surviving children of the
// app (the wire teardown really did kill the shim). Kill the daemon FIRST and close() resolves in
// milliseconds. The daemon can't be trusted to idle-out either: its idle self-exit arms only at
// zero panes (0024 FINDING-027, deliberately deferred), and every spec leaves a live pane.
// Production is untouched by all of this — real daemons run on the remote host.
import { expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { execSync } from 'child_process'
import { join, resolve, basename } from 'node:path'

export const SHIM = resolve('tests/fixtures/fake-ssh.mjs')

export function killTree(pid: number | undefined): void {
  try { if (pid && process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* gone */ }
}

/** Launch the app with remote connects routed through the fake-ssh shim into `fakeHome`. */
export function launchWithShim(
  userData: string, fakeHome: string, extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      // process.execPath is the Playwright runner's node — the shim (and everything it spawns:
      // agent, bridge, daemon) runs under plain node, exactly like the vitest suites.
      TERMHALLA_E2E_REMOTE_SSH: JSON.stringify({ program: process.execPath, prefixArgs: [SHIM] }),
      FAKE_SSH_HOME: fakeHome,
      FAKE_SSH_LOG: join(fakeHome, 'ssh-ledger.jsonl'),
      ...extraEnv
    }
  })
}

/** The picker flow: templates menu → remote workspace → add a named agent → create. The host is
 *  RFC 6761 `.invalid` — the shim never dials it. */
export async function createRemoteWorkspace(win: Page, agentName: string): Promise<void> {
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-remote-workspace').click()
  const picker = win.getByTestId('remote-agent-picker')
  await expect(picker).toBeVisible()
  await win.getByTestId('remote-agent-name').fill(agentName)
  await win.getByTestId('remote-agent-host').fill('agent.e2e.invalid')
  await win.getByTestId('remote-agent-user').fill('e2e')
  await win.getByTestId('remote-agent-add').click()
  await win.locator('[data-testid^="remote-agent-select-"]').first().click()
  await win.getByTestId('remote-agent-create').click()
  await expect(picker).toHaveCount(0)
}

/** Kill every node process working out of this fake home (daemon, stray bridge). Matched by the
 *  unique mkdtemp basename so no path-quoting can go wrong. */
export function reapFakeHome(fakeHome: string): void {
  const tag = basename(fakeHome)
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ` +
      `Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { timeout: 20_000 }
    )
  } catch { /* none left */ }
}

/** Daemon first, then close; force the tree only if close still hangs (that would be a NEW bug —
 *  the guard keeps the suite moving while making the hang visible in the report as slowness). */
export async function closeRemoteApp(app: ElectronApplication | undefined, fakeHome: string): Promise<void> {
  const pid = app?.process()?.pid
  reapFakeHome(fakeHome)
  const closed = await Promise.race([
    app?.close().then(() => true, () => false) ?? Promise.resolve(true),
    new Promise<boolean>(r => setTimeout(() => r(false), 20_000))
  ])
  if (!closed) killTree(pid)
}
