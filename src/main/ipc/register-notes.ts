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
  // An invoke (not a send) so the renderer OBSERVES a failed disk write: the rejection keeps the
  // key in the renderer's dirty set for retry + surfaces one error toast (2026-07-17 audit, F6).
  // A handle-thrown error becomes an invoke rejection — never Electron's modal error dialog.
  ipcMain.handle(CH.notesSet, (_e, key: string, text: string) => {
    if (!notes.set(key, text)) throw new Error('notes.json could not be written')
  })
  return () => notes.flush()
}
