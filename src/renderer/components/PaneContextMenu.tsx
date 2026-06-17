import { useState } from 'react'
import { useStore } from '../store'
import { Z, SURFACE } from './Modal'

/** Right-click menu for a pane's title bar: Rename, Move to workspace ▸ (other workspaces this
 *  window hosts, plus New Workspace), Settings, Close. Mirrors the WorkspaceTabs menu chrome. */
export function PaneContextMenu(
  { wsId, paneId, x, y, onRename, onClose }:
  { wsId: string; paneId: string; x: number; y: number; onRename: () => void; onClose: () => void }
) {
  const order = useStore(s => s.order)
  const names = useStore(s => Object.fromEntries(s.order.map(id => [id, s.workspaces[id]?.name ?? id])))
  const openSettings = useStore(s => s.openSettings)
  const closePane = useStore(s => s.closePane)
  const moveToWorkspace = useStore(s => s.movePaneToWorkspace)
  const moveToNew = useStore(s => s.movePaneToNewWorkspace)
  const [view, setView] = useState<'root' | 'move'>('root')

  const others = order.filter(id => id !== wsId)
  const menuStyle = { ...SURFACE, position: 'fixed' as const, left: x, top: y, zIndex: Z.menu + 1, padding: 4, display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 160, fontSize: 'var(--font-size, 13px)' }

  return (
    <>
      <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
      <div data-testid="pane-menu" style={menuStyle}>
        {view === 'root' ? (
          <>
            <button data-testid="pane-menu-rename" onClick={() => { onClose(); onRename() }}>Rename</button>
            <button data-testid="pane-menu-move" onClick={() => setView('move')}>Move to workspace ▸</button>
            <button data-testid="pane-menu-settings"
              onClick={() => { openSettings({ section: 'terminal', paneId }); onClose() }}>Settings</button>
            <button data-testid="pane-menu-close" onClick={() => { closePane(wsId, paneId); onClose() }}>Close</button>
          </>
        ) : (
          <>
            {others.map(id => (
              <button key={id} data-testid={`move-target-${id}`}
                onClick={() => { moveToWorkspace(paneId, wsId, id); onClose() }}>{names[id]}</button>
            ))}
            <button data-testid="move-new-workspace"
              onClick={() => { moveToNew(paneId, wsId); onClose() }}>New Workspace ＋</button>
          </>
        )}
      </div>
    </>
  )
}
