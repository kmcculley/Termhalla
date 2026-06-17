import { CH } from '@shared/ipc-contract'
import { GitStatusService } from '../git/git-status-service'
import type { Send, Disposer } from './types'

/** Build the per-pane git status service. It owns no ipcMain handlers — it is driven by the cwd /
 *  command-done / pane-gone hooks that registerPty forwards (the StatusEngine already emits those
 *  signals). Returns the service so register.ts can wire those hooks, plus a disposer that stops it
 *  (aborts in-flight probes, closes all .git watchers) on app shutdown. */
export function registerGit(send: Send): { service: GitStatusService; dispose: Disposer } {
  const service = new GitStatusService((paneId, status) => send(CH.gitStatus, paneId, status))
  return { service, dispose: () => service.stop() }
}
