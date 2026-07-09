import { app, ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { CloudStatusService } from '../cloud/cloud-status-service'
import type { Send, Disposer } from './types'

/** How long after a window focus we suppress a duplicate cloud-status refresh. */
const CLOUD_FOCUS_REFRESH_MS = 5000

/** Cloud CLI status polling + a focus-triggered refresh (debounced). Returns a disposer that stops polling. */
export function registerCloud(_win: BrowserWindow, send: Send): Disposer {
  const cloud = new CloudStatusService((statuses) => send(CH.cloudStatus, statuses))
  cloud.start()
  ipcMain.handle(CH.cloudRefresh, () => cloud.refresh())
  // Pull-on-mount: the cloud:status push is fire-and-forget, so a renderer that subscribes after the
  // first probe completes (common when restoring a heavy session) misses it, and dedup blocks a
  // re-send — leaving the chip stuck on "cloud status…". The renderer recovers by pulling this.
  ipcMain.handle(CH.cloudCurrent, () => cloud.snapshot())

  // App-level, not `win.on('focus')` (window-management follow-up, fixed 2026-07-09): focusing an
  // UNDOCKED window is just as much "the user came back" as focusing main — the old main-only hook
  // meant a multi-window session working out of a floating window never focus-refreshed. One
  // debounce across all windows; results broadcast to every window as before.
  let lastFocusRefresh = 0
  const onFocus = (): void => {
    const t = Date.now()
    if (t - lastFocusRefresh > CLOUD_FOCUS_REFRESH_MS) { lastFocusRefresh = t; void cloud.refresh() }
  }
  app.on('browser-window-focus', onFocus)

  return () => {
    app.removeListener('browser-window-focus', onFocus)
    cloud.stop(); ipcMain.removeHandler(CH.cloudRefresh); ipcMain.removeHandler(CH.cloudCurrent)
  }
}
