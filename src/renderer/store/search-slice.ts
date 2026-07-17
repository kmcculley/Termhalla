import type { State, SliceDeps } from './types'
import { requestPaneFocus } from '../components/terminal-registry'

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
      // Track first, then activate: setActive's refocusActivePane reads focusedPaneId, so the
      // reverse order aimed it at the stale pane (it only worked via the Modal-close refocus a
      // microtask later). Mirrors focusMruPaneMatch (pane-reveal.ts).
      s.setFocusedPane(paneId)
      s.setActive(wsId)
      requestPaneFocus(paneId)
      set({ searchOpen: false })
    },

    relaunchFromSearch: (cwd) => {
      if (!cwd) return   // a hit with no cwd can't be relaunched — keep the modal open
      get().launchDir(cwd)
      set({ searchOpen: false })
    }
  }
}
