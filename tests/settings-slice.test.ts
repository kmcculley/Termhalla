import { describe, it, expect } from 'vitest'
import { createSettingsSlice } from '../src/renderer/store/settings-slice'

function harness() {
  let state: any = { settings: null }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  return { slice: createSettingsSlice({ set, get } as any), get }
}

describe('settings slice', () => {
  it('openSettings sets the target', () => {
    const { slice, get } = harness()
    slice.openSettings({ section: 'appearance', paneId: 'p1' })
    expect(get().settings).toEqual({ section: 'appearance', paneId: 'p1' })
  })
  it('closeSettings clears it', () => {
    const { slice, get } = harness()
    slice.openSettings({ section: 'general' })
    slice.closeSettings()
    expect(get().settings).toBeNull()
  })
})
