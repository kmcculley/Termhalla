import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../src/renderer/components/terminal-registry', () => ({ requestPaneFocus: vi.fn() }))
import { createSearchSlice } from '../../src/renderer/store/search-slice'
import { requestPaneFocus } from '../../src/renderer/components/terminal-registry'

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
    const calls: string[] = []
    const setActive = vi.fn(() => calls.push('setActive'))
    const setFocusedPane = vi.fn(() => calls.push('setFocusedPane'))
    const { slice } = harness({
      workspaces: { w1: { id: 'w1', panes: { p1: { paneId: 'p1', config: { kind: 'terminal' } } } } },
      setActive, setFocusedPane
    })
    slice.revealPaneFromSearch('p1')
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(setFocusedPane).toHaveBeenCalledWith('p1')
    // Track BEFORE activating: setActive's refocusActivePane reads focusedPaneId, so the old
    // order aimed the refocus at the stale pane and relied on the modal-close refocus to fix it.
    expect(calls.indexOf('setFocusedPane')).toBeLessThan(calls.indexOf('setActive'))
    // And focus the pane explicitly rather than depending on the Modal-close refocus.
    expect(requestPaneFocus).toHaveBeenCalledWith('p1')
  })
  it('revealPaneFromSearch no-ops for an unknown pane', () => {
    const setActive = vi.fn()
    const { slice } = harness({ setActive })
    slice.revealPaneFromSearch('ghost')
    expect(setActive).not.toHaveBeenCalled()
  })
})
