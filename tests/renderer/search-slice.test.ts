import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/renderer/api', () => ({ api: {} }))
import { createSearchSlice } from '../../src/renderer/store/search-slice'

function harness(initial: any = {}) {
  let state: any = { searchOpen: false, activeId: null, focusedPaneId: null, workspaces: {}, ...initial }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const slice = createSearchSlice({ set, get } as any)
  return { slice, get, set: (p: any) => set(p) }
}

describe('search slice', () => {
  it('setSearchOpen toggles the modal', () => {
    const { slice, get } = harness()
    slice.setSearchOpen(true)
    expect(get().searchOpen).toBe(true)
  })
  it('revealPaneFromSearch activates the pane\'s workspace + focuses it', () => {
    const setActive = vi.fn(); const setFocusedPane = vi.fn()
    const { slice } = harness({
      workspaces: { w1: { id: 'w1', panes: { p1: { paneId: 'p1', config: { kind: 'terminal' } } } } },
      setActive, setFocusedPane
    })
    slice.revealPaneFromSearch('p1')
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(setFocusedPane).toHaveBeenCalledWith('p1')
  })
  it('revealPaneFromSearch no-ops for an unknown pane', () => {
    const setActive = vi.fn()
    const { slice } = harness({ setActive })
    slice.revealPaneFromSearch('ghost')
    expect(setActive).not.toHaveBeenCalled()
  })
})
