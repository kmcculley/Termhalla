import { ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { NotesStore } from '../persistence/notes-store'

/** Per-project notepad persistence. Mirrors registerDrafts: load on start, set on demand,
 *  synchronous flush on window close (covers app close, where renderer cleanups don't run). */
export function registerNotes(win: BrowserWindow, userDataDir: string): void {
  const notes = new NotesStore(userDataDir)
  void notes.load()
  ipcMain.handle(CH.notesLoad, () => notes.load())
  ipcMain.on(CH.notesSet, (_e, key: string, text: string) => notes.set(key, text))
  win.on('close', () => notes.flush())
}
