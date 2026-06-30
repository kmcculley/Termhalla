import { ipcMain, BrowserWindow, type IpcMainEvent } from 'electron'
import { CH } from '@shared/ipc-contract'
import { OrkyTracker } from '../orky/orky-tracker'
import type { Send, Disposer } from './types'

/** Orky `.orky/` status watcher. Mirrors `registerUsage`: the tracker emits a pane-scoped
 *  `orky:status` push (routed to the owning window by `send`), and the returned disposer tears down
 *  every watcher on shutdown (CLAUDE.md long-lived-watcher obligation).
 *
 *  Hardened at the IPC boundary (REQ-024): each handler (a) rejects a non-string `id`/`cwd` BEFORE
 *  touching the tracker — so a malformed IPC message cannot become an unhandled rejection that kills the
 *  main process (FINDING-SEC-001) — and (b) acts ONLY for events whose `sender` belongs to its own
 *  `BrowserWindow` (mirroring register-pty's `claimPane`), so one window cannot open/cancel/leak another
 *  window's watchers (FINDING-SEC-002 cross-window disclosure). */
export function registerOrky(send: Send, win: BrowserWindow): Disposer {
  const orky = new OrkyTracker((id, status) => send(CH.orkyStatus, id, status))
  const ownsSender = (e: IpcMainEvent): boolean => BrowserWindow.fromWebContents(e.sender) === win

  const onWatch = (e: IpcMainEvent, id: unknown, cwd: unknown): void => {
    if (!ownsSender(e)) return
    if (typeof id !== 'string' || typeof cwd !== 'string') return
    void orky.watch(id, cwd)
  }
  const onUnwatch = (e: IpcMainEvent, id: unknown): void => {
    if (!ownsSender(e)) return
    if (typeof id !== 'string') return
    orky.unwatch(id)
  }
  ipcMain.on(CH.orkyWatch, onWatch)
  ipcMain.on(CH.orkyUnwatch, onUnwatch)
  return () => {
    ipcMain.removeListener(CH.orkyWatch, onWatch)
    ipcMain.removeListener(CH.orkyUnwatch, onUnwatch)
    orky.dispose()
  }
}
