import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { CH } from '@shared/ipc-contract'
import { WORKSPACE_DOC_EXT } from '@shared/workspace-doc'
import { atomicWrite } from '../persistence/atomic-write'
import { WorkspaceDocStore } from '../persistence/workspace-doc-store'
import type { Disposer } from './types'

const FILTERS = [{ name: 'Termhalla Workspace', extensions: [WORKSPACE_DOC_EXT] }]

/** Portable workspace-document handlers (File ▸ Open / Save / Save As) plus the persisted
 *  workspaceId→documentPath binding map. Dialogs anchor to the invoking window (multi-window safe,
 *  the register-fs `senderWin` idiom). Read/write degrade to null/false rather than throwing across
 *  IPC — a bad path surfaces as a toast, never a modal-freezing uncaught rejection. Returns a
 *  disposer that flushes the binding store on teardown. */
export function registerWorkspaceDoc(win: BrowserWindow, dir: string): Disposer {
  const store = new WorkspaceDocStore(dir)
  void store.load()
  const senderWin = (e: { sender: Electron.WebContents }): BrowserWindow => BrowserWindow.fromWebContents(e.sender) ?? win

  ipcMain.handle(CH.wsdocPickSave, async (e, defaultName: string) => {
    // Test hook: hermetic e2e can't drive a native dialog (the register-fs TERMHALLA_SAVE_PATH precedent).
    if (process.env.TERMHALLA_WSDOC_SAVE_PATH) return process.env.TERMHALLA_WSDOC_SAVE_PATH
    const r = await dialog.showSaveDialog(senderWin(e), { defaultPath: defaultName, filters: FILTERS })
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle(CH.wsdocPickOpen, async (e) => {
    if (process.env.TERMHALLA_WSDOC_OPEN_PATH) return process.env.TERMHALLA_WSDOC_OPEN_PATH
    const r = await dialog.showOpenDialog(senderWin(e), { properties: ['openFile'], filters: FILTERS })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle(CH.wsdocRead, async (_e, path: string) => {
    try { return await readFile(path, 'utf8') }
    catch (err) { console.warn('[wsdoc] read failed:', err); return null }
  })

  ipcMain.handle(CH.wsdocWrite, async (_e, path: string, contents: string) => {
    try { await atomicWrite(path, contents); return true }
    catch (err) { console.warn('[wsdoc] write failed:', err); return false }
  })

  ipcMain.handle(CH.wsdocPathsLoad, () => store.all())
  ipcMain.on(CH.wsdocPathSet, (_e, workspaceId: string, path: string) => store.set(workspaceId, path))
  ipcMain.on(CH.wsdocPathClear, (_e, workspaceId: string) => store.clear(workspaceId))

  return () => store.flush()
}
