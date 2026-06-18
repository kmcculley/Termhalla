import type { State, SliceDeps } from './types'

type SearchSlice = Pick<State, 'setSearchOpen' | 'revealPaneFromSearch' | 'relaunchFromSearch'>

/** Search-history UI state + the two result actions: reveal (focus the source pane if it still
 *  exists) and relaunch (open a fresh terminal at the hit's cwd). */
export function createSearchSlice({ set, get }: SliceDeps): SearchSlice {
  return {
    setSearchOpen: (open) => set({ searchOpen: open }),

    revealPaneFromSearch: (paneId) => {
      const s = get()
      const wsId = Object.keys(s.workspaces).find(id => s.workspaces[id]?.panes[paneId])
      if (!wsId) return
      s.setActive(wsId)
      s.setFocusedPane(paneId)
      set({ searchOpen: false })
    },

    relaunchFromSearch: (cwd) => {
      get().launchDir(cwd)
      set({ searchOpen: false })
    }
  }
}
