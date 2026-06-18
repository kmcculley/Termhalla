import type { State, SliceDeps } from './types'

type NotesSlice = Pick<State, 'setNotesOpen' | 'setNotesProject' | 'setNote'>

/** Per-project notepad: the open/closed drawer state, the currently shown project key (set by the
 *  panel's tracking effect, sticky on empty), and the note map. setNote updates the map for instant
 *  UI and debounces the disk write via scheduleNotesSave (which calls api.notesSet in store.ts). */
export function createNotesSlice({ set, scheduleNotesSave }: SliceDeps): NotesSlice {
  return {
    setNotesOpen: (open) => set({ notesOpen: open }),
    setNotesProject: (key) => set({ notesProjectKey: key }),
    setNote: (key, text) => {
      set(s => ({ notes: { ...s.notes, [key]: text } }))
      scheduleNotesSave()
    }
  }
}
