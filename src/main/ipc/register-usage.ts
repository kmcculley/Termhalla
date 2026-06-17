import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import { UsageTracker } from '../usage/usage-tracker'
import type { Send, Disposer } from './types'

/** Claude usage-metrics watcher. Returns a disposer that stops the watcher. */
export function registerUsage(send: Send): Disposer {
  const usage = new UsageTracker((id, metrics) => send(CH.usageMetrics, id, metrics))
  ipcMain.on(CH.usageWatch, (_e, id: string, cwd: string) => { void usage.watch(id, cwd) })
  ipcMain.on(CH.usageUnwatch, (_e, id: string) => usage.unwatch(id))
  return () => usage.dispose()
}
