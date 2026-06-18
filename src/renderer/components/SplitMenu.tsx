import { useStore, paneCwd } from '../store'
import { Z, SURFACE } from './Modal'
import type { MosaicDirection } from '@shared/types'

/** In-tile popover for the split buttons: choose what kind of pane the split opens. The new pane
 *  splits the source pane in `dir` and inherits its cwd (terminals via addTerminal, explorers via
 *  the cwd as root; editors have no cwd). Replaces the old "split always opens a terminal". */
export function SplitMenu(
  { wsId, paneId, dir, onClose }: { wsId: string; paneId: string; dir: MosaicDirection; onClose: () => void }
) {
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const cwd = useStore(s => paneCwd(s, paneId))
  const pick = (fn: () => void) => { fn(); onClose() }
  return (
    <div data-testid="split-menu" onClick={e => e.stopPropagation()}
      style={{ ...SURFACE, position: 'absolute', right: 4, top: 28, zIndex: Z.popover, padding: 4,
        display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button data-testid={`split-terminal-${paneId}`}
        onClick={() => pick(() => addTerminal(wsId, paneId, dir))}>Terminal</button>
      <button data-testid={`split-editor-${paneId}`}
        onClick={() => pick(() => addEditor(wsId, paneId, dir))}>Editor</button>
      <button data-testid={`split-explorer-${paneId}`} disabled={!cwd}
        onClick={() => pick(() => addExplorer(wsId, paneId, dir, cwd))}>Explorer</button>
    </div>
  )
}
