import { useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'

export interface TabGhost { x: number; y: number; id: string }

const DRAG_THRESHOLD_PX = 6

/** Pointer-drag handling for the workspace tab strip, lifted out of WorkspaceTabs so the component
 *  stays markup + small handlers. Below the threshold a press is a click (activate); past it a
 *  ghost follows the cursor. On release an intra-strip drop over another tab reorders; otherwise
 *  main decides undock (off the strip → new OS window) vs re-dock (onto another window's strip)
 *  from the screen position. */
export function useTabDrag(
  setActive: (id: string) => void,
  moveWorkspace: (fromId: string, toId: string) => void
): { ghost: TabGhost | null; beginTabDrag: (id: string) => (e: React.PointerEvent) => void } {
  const [ghost, setGhost] = useState<TabGhost | null>(null)

  const beginTabDrag = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const startX = e.clientX, startY = e.clientY
    let dragging = false
    // Screen-cursor feed for the OS-level ghost window: the DOM ghost below clips at the window
    // edge, so main shows a mini window once the cursor leaves every app window. Throttled to one
    // send per frame (pointermove can fire at mouse polling rate).
    let ghostQueued: { x: number; y: number; name: string } | null = null
    const flushGhost = () => {
      if (ghostQueued) { api.winDragGhost(ghostQueued); ghostQueued = null }
    }
    const onMove = (me: PointerEvent) => {
      if (!dragging && Math.hypot(me.clientX - startX, me.clientY - startY) < DRAG_THRESHOLD_PX) return
      dragging = true
      setGhost({ x: me.clientX, y: me.clientY, id })
      const name = useStore.getState().workspaces[id]?.name ?? ''
      if (!ghostQueued) requestAnimationFrame(flushGhost)
      ghostQueued = { x: me.screenX, y: me.screenY, name }
    }
    const onUp = (ue: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGhost(null)
      ghostQueued = null                        // cancel any queued move racing the end signal
      if (dragging) api.winDragGhost(null)      // drag over: drop the OS ghost on every path
      if (!dragging) { setActive(id); return }
      const overTab = (ue.target as HTMLElement | null)?.closest?.('[data-tab-id]') as HTMLElement | null
      const overId = overTab?.dataset.tabId
      if (overId && overId !== id) { moveWorkspace(id, overId); return }
      // Flush the workspace to disk first: the new window loads it from disk, and autosave is
      // debounced, so without this the torn-off window can load a stale/absent file.
      const cursor = { x: ue.screenX, y: ue.screenY }
      void useStore.getState().saveAll().then(() => api.winDragEnd({ workspaceId: id, cursor }))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return { ghost, beginTabDrag }
}
