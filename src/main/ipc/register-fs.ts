import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { readTextFile, writeTextFile, readDirectory, statPath, renamePath } from '../fs/files'
import { WatchManager } from '../fs/watch-manager'
import type { Send, Disposer } from './types'

/** Filesystem read/write/watch handlers plus the native file/folder dialogs and shell reveal.
 *  Returns a disposer that closes all watches. `win` is the fallback dialog parent; each dialog
 *  actually anchors to the window that invoked it (so a dialog from an undocked window appears
 *  over that window, not the main one). */
export function registerFs(win: BrowserWindow, send: Send): Disposer {
  const watcher = new WatchManager((id, change) => send(CH.fsChange, id, change))
  const senderWin = (e: { sender: Electron.WebContents }): BrowserWindow => BrowserWindow.fromWebContents(e.sender) ?? win

  ipcMain.handle(CH.fsRead, (_e, path: string) => readTextFile(path))
  ipcMain.handle(CH.fsWrite, (_e, path: string, content: string) => writeTextFile(path, content))
  ipcMain.handle(CH.fsReadDir, (_e, path: string) => readDirectory(path))
  ipcMain.handle(CH.fsStat, (_e, path: string) => statPath(path))
  ipcMain.on(CH.fsWatch, (_e, id: string, path: string) => watcher.watch(id, path))
  ipcMain.on(CH.fsUnwatch, (_e, id: string) => watcher.unwatch(id))

  // Open-dialog handler differing only in what it picks; returns the single path or null.
  const pickOne = (property: 'openDirectory' | 'openFile') => async (e: { sender: Electron.WebContents }) => {
    const r = await dialog.showOpenDialog(senderWin(e), { properties: [property] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }
  ipcMain.handle(CH.dialogOpenFolder, pickOne('openDirectory'))
  ipcMain.handle(CH.dialogOpenFile, pickOne('openFile'))
  ipcMain.handle(CH.dialogSaveFile, async (e) => {
    // Test hook: hermetic e2e can't drive a native dialog (mirrors TERMHALLA_CLAUDE_HOME).
    if (process.env.TERMHALLA_SAVE_PATH) return process.env.TERMHALLA_SAVE_PATH
    const r = await dialog.showSaveDialog(senderWin(e), {})
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle(CH.revealPath, async (_e, path: string) => { await shell.openPath(path) })
  ipcMain.handle(CH.fsRename, (_e, oldPath: string, newPath: string) => renamePath(oldPath, newPath))
  ipcMain.handle(CH.fsTrash, (_e, path: string) => shell.trashItem(path))
  ipcMain.handle(CH.fsRevealItem, (_e, path: string) => { shell.showItemInFolder(path) })

  return () => watcher.closeAll()
}
