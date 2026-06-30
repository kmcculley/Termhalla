import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import { OrkyTracker } from '../orky/orky-tracker'
import type { Send, Disposer } from './types'

/** Orky `.orky/` status watcher. Mirrors `registerUsage`: the tracker emits a pane-scoped
 *  `orky:status` push (routed to the owning window by `send`), and the returned disposer tears down
 *  every watcher on shutdown (CLAUDE.md long-lived-watcher obligation). */
export function registerOrky(send: Send): Disposer {
  const orky = new OrkyTracker((id, status) => send(CH.orkyStatus, id, status))
  ipcMain.on(CH.orkyWatch, (_e, id: string, cwd: string) => { void orky.watch(id, cwd) })
  ipcMain.on(CH.orkyUnwatch, (_e, id: string) => orky.unwatch(id))
  return () => orky.dispose()
}
