import { ipcMain, clipboard } from 'electron'
import { CH } from '@shared/ipc-contract'
import { writeTextReliably } from '../clipboard/reliable-clipboard'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** System clipboard access for the renderer (Electron's clipboard lives in main).
 *  Read is request/response; write is fire-and-forget. No long-lived resources, so
 *  no disposer.
 *
 *  Write goes through `writeTextReliably` (verify + retry) rather than a bare
 *  `clipboard.writeText`: on Windows a single global clipboard is briefly locked by RDP / Horizon /
 *  PowerToys / Phone Link clipboard redirectors right after any change, and Electron's writeText
 *  fails silently in that window — the cause of "copy sometimes doesn't work." */
export function registerClipboard(): void {
  ipcMain.on(CH.clipboardWrite, (_e, text: string) => { void writeTextReliably(clipboard, text, sleep) })
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
}
