import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { EditorDraft } from '@shared/types'
import { DraftStore } from '../persistence/draft-store'

/** Editor draft (unsaved-buffer) persistence. Writes are live on every set/delete; the returned
 *  flush is the synchronous shutdown safety net, wired (by the composition root) to every window's
 *  close — not just the main window's — so a floating window closing first still flushes. */
export function registerDrafts(userDataDir: string): () => void {
  const drafts = new DraftStore(userDataDir)
  void drafts.load()
  ipcMain.handle(CH.draftsLoad, () => drafts.load())
  ipcMain.on(CH.draftsSet, (_e, key: string, draft: EditorDraft) => drafts.set(key, draft))
  ipcMain.on(CH.draftsDelete, (_e, key: string) => drafts.delete(key))
  return () => drafts.flush()
}
