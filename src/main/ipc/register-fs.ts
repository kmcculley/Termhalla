import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { readTextFile, writeTextFile, readDirectory, statPath } from '../fs/files'
import { WatchManager } from '../fs/watch-manager'
import type { Send, Disposer } from './types'

/** Filesystem read/write/watch handlers plus the native file/folder dialogs and shell reveal.
 *  Returns a disposer that closes all watches. */
export function registerFs(win: BrowserWindow, send: Send): Disposer {
  const watcher = new WatchManager((id, change) => send(CH.fsChange, id, change))

  ipcMain.handle(CH.fsRead, (_e, path: string) => readTextFile(path))
  ipcMain.handle(CH.fsWrite, (_e, path: string, content: string) => writeTextFile(path, content))
  ipcMain.handle(CH.fsReadDir, (_e, path: string) => readDirectory(path))
  ipcMain.handle(CH.fsStat, (_e, path: string) => statPath(path))
  ipcMain.on(CH.fsWatch, (_e, id: string, path: string) => watcher.watch(id, path))
  ipcMain.on(CH.fsUnwatch, (_e, id: string) => watcher.unwatch(id))

  ipcMain.handle(CH.dialogOpenFolder, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(CH.dialogOpenFile, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(CH.dialogSaveFile, async () => {
    // Test hook: hermetic e2e can't drive a native dialog (mirrors TERMHALLA_CLAUDE_HOME).
    if (process.env.TERMHALLA_SAVE_PATH) return process.env.TERMHALLA_SAVE_PATH
    const r = await dialog.showSaveDialog(win, {})
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle(CH.revealPath, async (_e, path: string) => { await shell.openPath(path) })

  return () => watcher.closeAll()
}
