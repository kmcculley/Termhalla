import { type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { detectShells } from '../pty/shells'
import type { PtyManager } from '../pty/pty-manager'
import { writeIntegrationScripts } from '../status/integration-scripts'
import { WorkspaceStore } from '../persistence/store'
import { QuickStore } from '../persistence/quick-store'
import { userDataDir } from '../persistence/paths'
import { Recorder } from '../recording/recorder'
import { EnvVault } from '../env-vault/env-vault'
import type { Disposer } from './types'
import { registerPty } from './register-pty'
import { registerFs } from './register-fs'
import { registerWorkspaces } from './register-workspaces'
import { registerDrafts } from './register-drafts'
import { registerCloud } from './register-cloud'
import { registerUsage } from './register-usage'
import { registerRecording } from './register-recording'
import { registerEnv } from './register-env'
import { registerClipboard } from './register-clipboard'

/** Composition root: build the shared services, then hand each subsystem to its own registrar.
 *  Adding a feature means extending the relevant register-*.ts (or adding a new one here), not
 *  growing one monolith. Returns the PtyManager so the window can kill PTYs on close. */
export function registerHandlers(win: BrowserWindow): PtyManager {
  const dir = userDataDir()
  const store = new WorkspaceStore(dir)
  const quick = new QuickStore(dir)
  const shells = detectShells()
  const recorder = new Recorder()
  const envVault = new EnvVault(dir)

  const scriptDir = join(dir, 'shell-integration')
  writeIntegrationScripts(scriptDir)

  // Main->renderer events can still fire during teardown (e.g. pty exit events after the
  // window/webContents is destroyed on app close). Guard every send so it never throws
  // "Object has been destroyed".
  const send = (channel: string, ...args: unknown[]): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  const pty = registerPty(win, { shells, recorder, envVault, scriptDir, send })
  registerWorkspaces({ store, quick, shells })
  registerEnv(win, envVault, send)
  registerClipboard()
  registerDrafts(win, dir)

  // Disposers for the long-lived services, aggregated into one teardown. `drafts.flush()` stays
  // on the earlier `close` event (inside registerDrafts) because it must run synchronously while
  // the window still exists.
  const disposers: Disposer[] = [
    registerFs(win, send),
    registerCloud(win, send),
    registerUsage(send),
    registerRecording({ pty, recorder, userDataDir: dir, send })
  ]
  win.on('closed', () => { for (const dispose of disposers) dispose() })

  return pty
}
