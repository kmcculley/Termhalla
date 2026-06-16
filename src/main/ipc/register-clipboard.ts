import { ipcMain, clipboard } from 'electron'
import { CH } from '@shared/ipc-contract'

/** System clipboard access for the renderer (Electron's clipboard lives in main).
 *  Read is request/response; write is fire-and-forget. No long-lived resources, so
 *  no disposer. */
export function registerClipboard(): void {
  ipcMain.on(CH.clipboardWrite, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
}
