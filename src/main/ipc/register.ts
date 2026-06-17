import type { Services } from '../services'
import type { WindowManager } from '../window-manager'
import type { PtyManager } from '../pty/pty-manager'
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
import { registerGit } from './register-git'

/** Composition root: register every IPC handler ONCE against the build-once service layer. Push
 *  events go through `send`, which routes pane-scoped channels (their first arg is a paneId) to the
 *  window that owns the pane and broadcasts app-global channels to all windows. The interactive
 *  registrars (notify/dialogs/drafts) take the main window, which already exists after
 *  `WindowManager.prepare()`. Returns the PtyManager so the app can kill PTYs on quit. */
export function registerHandlers(services: Services, wm: WindowManager): PtyManager {
  const { store, quick, shells, recorder, envVault, scriptDir, dir } = services

  const send = (channel: string, ...args: unknown[]): void => {
    const paneId = typeof args[0] === 'string' ? args[0] : null
    if (paneId && wm.isPaneScoped(channel)) wm.routeToPane(paneId, channel, ...args)
    else wm.broadcast(channel, ...args)
  }

  const win = wm.mainWindow()
  const { service: git, dispose: disposeGit } = registerGit(send)
  const pty = registerPty(win, {
    shells, recorder, envVault, scriptDir, send,
    claimPane: (id, sender) => wm.claimPane(id, sender),
    replayInto: (id) => wm.replayInto(id),
    onCwd: (id, cwd) => { void git.setCwd(id, cwd) },
    onCommandDone: (id) => git.onCommandDone(id),
    onPaneGone: (id) => git.removePane(id)
  })
  registerWorkspaces({ store, quick, shells })
  registerEnv(win, envVault, send)
  registerClipboard()
  registerDrafts(win, dir)

  const disposers: Disposer[] = [
    registerFs(win, send),
    registerCloud(win, send),
    registerUsage(send),
    registerRecording({ pty, recorder, userDataDir: dir, send }),
    disposeGit
  ]
  wm.onAllWindowsClosed(() => { for (const dispose of disposers) dispose() })

  return pty
}
