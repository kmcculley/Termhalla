import { useStore } from '../store'
import { api } from '../api'
import { MenuSurface } from './MenuSurface'

/** Popover with folder actions for a pane's current working directory, anchored to its tile.
 *  Rendered through the shared MenuSurface so click-away and Escape dismiss it like every menu. */
export function CwdMenu(
  { wsId, paneId, cwd, anchor, onClose }: {
    wsId: string; paneId: string; cwd: string; anchor: React.CSSProperties; onClose: () => void
  }
) {
  const openExplorerHere = useStore(s => s.openExplorerHere)
  return (
    <MenuSurface testid="cwd-menu" portal onClose={onClose} style={{ ...anchor, padding: 4, gap: 2 }}>
      <button data-testid={`open-explorer-here-${paneId}`} disabled={!cwd}
        onClick={() => { openExplorerHere(wsId, paneId); onClose() }}>Open Explorer here</button>
      <button data-testid={`reveal-here-${paneId}`} disabled={!cwd}
        onClick={() => { void api.revealPath(cwd); onClose() }}>Reveal in File Explorer</button>
    </MenuSurface>
  )
}
