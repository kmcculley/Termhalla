import { useStore } from '../store'
import { api } from '../api'
import { Z, SURFACE } from './Modal'

/** In-tile popover with folder actions for a pane's current working directory. */
export function CwdMenu(
  { wsId, paneId, cwd, onClose }: { wsId: string; paneId: string; cwd: string; onClose: () => void }
) {
  const openExplorerHere = useStore(s => s.openExplorerHere)
  return (
    <div data-testid="cwd-menu" onClick={e => e.stopPropagation()}
      style={{ ...SURFACE, position: 'absolute', right: 4, top: 28, zIndex: Z.popover, padding: 4,
        display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button data-testid={`open-explorer-here-${paneId}`} disabled={!cwd}
        onClick={() => { openExplorerHere(wsId, paneId); onClose() }}>Open Explorer here</button>
      <button data-testid={`reveal-here-${paneId}`} disabled={!cwd}
        onClick={() => { void api.revealPath(cwd); onClose() }}>Reveal in File Explorer</button>
    </div>
  )
}
