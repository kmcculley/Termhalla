import { ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { CloudStatusService } from '../cloud/cloud-status-service'
import type { Send, Disposer } from './types'

/** How long after a window focus we suppress a duplicate cloud-status refresh. */
const CLOUD_FOCUS_REFRESH_MS = 5000

/** Cloud CLI status polling + a focus-triggered refresh (debounced). Returns a disposer that stops polling. */
export function registerCloud(win: BrowserWindow, send: Send): Disposer {
  const cloud = new CloudStatusService((statuses) => send(CH.cloudStatus, statuses))
  cloud.start()
  ipcMain.handle(CH.cloudRefresh, () => cloud.refresh())

  let lastFocusRefresh = 0
  win.on('focus', () => {
    const t = Date.now()
    if (t - lastFocusRefresh > CLOUD_FOCUS_REFRESH_MS) { lastFocusRefresh = t; void cloud.refresh() }
  })

  return () => cloud.stop()
}
