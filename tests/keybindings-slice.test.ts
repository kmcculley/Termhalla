import { describe, it, expect, vi } from 'vitest'
import { createKeybindingsSlice } from '../src/renderer/store/keybindings-slice'

function harness() {
  let state: any = { quick: { keybindings: {} } }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const scheduleQuickSave = vi.fn()
  return { slice: createKeybindingsSlice({ set, get, scheduleQuickSave } as any), get, scheduleQuickSave }
}

describe('keybindings slice', () => {
  it('setBinding stores the chordKey and schedules a save', () => {
    const { slice, get, scheduleQuickSave } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    expect(get().quick.keybindings['new-terminal']).toBe('mod+shift+n')
    expect(scheduleQuickSave).toHaveBeenCalled()
  })
  it('unbindCommand writes the none sentinel', () => {
    const { slice, get } = harness()
    slice.unbindCommand('close-workspace')
    expect(get().quick.keybindings['close-workspace']).toBe('none')
  })
  it('resetBinding removes the override', () => {
    const { slice, get } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    slice.resetBinding('new-terminal')
    expect(get().quick.keybindings['new-terminal']).toBeUndefined()
  })
  it('resetAllBindings clears the map', () => {
    const { slice, get } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    slice.resetAllBindings()
    expect(get().quick.keybindings).toEqual({})
  })
})
