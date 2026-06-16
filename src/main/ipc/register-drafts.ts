import { ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { EditorDraft } from '@shared/types'
import { DraftStore } from '../persistence/draft-store'

/** Editor draft (unsaved-buffer) persistence. Flush stays on `close` (not `closed`) so it runs
 *  synchronously while the window still exists. */
export function registerDrafts(win: BrowserWindow, userDataDir: string): void {
  const drafts = new DraftStore(userDataDir)
  void drafts.load()
  ipcMain.handle(CH.draftsLoad, () => drafts.load())
  ipcMain.on(CH.draftsSet, (_e, key: string, draft: EditorDraft) => drafts.set(key, draft))
  ipcMain.on(CH.draftsDelete, (_e, key: string) => drafts.delete(key))
  win.on('close', () => drafts.flush())
}
