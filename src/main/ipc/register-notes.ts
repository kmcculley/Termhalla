import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import { NotesStore } from '../persistence/notes-store'

/** Per-project notepad persistence. Mirrors registerDrafts: load on start, set on demand. Returns a
 *  synchronous flush for the composition root to wire to every window's close (covers app close,
 *  where renderer cleanups don't run). */
export function registerNotes(userDataDir: string): () => void {
  const notes = new NotesStore(userDataDir)
  void notes.load()
  ipcMain.handle(CH.notesLoad, () => notes.load())
  ipcMain.on(CH.notesSet, (_e, key: string, text: string) => notes.set(key, text))
  return () => notes.flush()
}
