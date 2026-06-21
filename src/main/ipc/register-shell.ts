import { ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc-contract'

/** Open `url` in the default browser, but only for http(s) — never file:/javascript:/etc. Pure of
 *  Electron (open is injected) so it can be unit-tested. */
export function safeOpenExternal(url: string, open: (u: string) => void): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') open(url)
  } catch { /* not a URL: ignore */ }
}

/** Register the open-external handler. Fire-and-forget; no long-lived resources, so no disposer. */
export function registerShell(deps: { openExternal?: (u: string) => void } = {}): void {
  const open = deps.openExternal ?? ((u: string) => { void shell.openExternal(u) })
  ipcMain.on(CH.shellOpenExternal, (_e, url: string) => safeOpenExternal(url, open))
}
