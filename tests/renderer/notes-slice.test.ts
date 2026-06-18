import { describe, it, expect, vi } from 'vitest'
import { createNotesSlice } from '../../src/renderer/store/notes-slice'

function harness() {
  let state: any = { notes: {}, notesOpen: false, notesProjectKey: null }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const scheduleNotesSave = vi.fn()
  const slice = createNotesSlice({ set, get, scheduleNotesSave } as any)
  return { slice, get, scheduleNotesSave }
}

describe('notes slice', () => {
  it('setNote updates the map and schedules a save', () => {
    const { slice, get, scheduleNotesSave } = harness()
    slice.setNote('/proj', 'hello')
    expect(get().notes['/proj']).toBe('hello')
    expect(scheduleNotesSave).toHaveBeenCalledWith('/proj')
  })
  it('setNotesProject sets the current key', () => {
    const { slice, get } = harness()
    slice.setNotesProject('/proj')
    expect(get().notesProjectKey).toBe('/proj')
  })
  it('setNotesOpen toggles the drawer', () => {
    const { slice, get } = harness()
    slice.setNotesOpen(true)
    expect(get().notesOpen).toBe(true)
  })
})
