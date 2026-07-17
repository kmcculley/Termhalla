import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { api } from '../api'
import { resolveBindings, formatChord } from '@shared/keybindings'
import { clearPane, openPaneFind } from './terminal-registry'
import { MenuSurface } from './MenuSurface'

/** Right-click menu for a pane's title bar: Rename, Move to workspace ▸ (other workspaces this
 *  window hosts, plus New Workspace), Settings, Close. Mirrors the WorkspaceTabs menu chrome. */
export function PaneContextMenu(
  { wsId, paneId, x, y, onRename, onClose }:
  { wsId: string; paneId: string; x: number; y: number; onRename: () => void; onClose: () => void }
) {
  const order = useStore(s => s.order)
  // useShallow: this selector derives a fresh object each call; under zustand v5's default Object.is
  // equality that would re-fire on every render and blow the update depth (React error #185).
  const names = useStore(useShallow(s => Object.fromEntries(s.order.map(id => [id, s.workspaces[id]?.name ?? id]))))
  const openSettings = useStore(s => s.openSettings)
  const closePane = useStore(s => s.closePane)
  const toggleMinimize = useStore(s => s.toggleMinimize)
  const moveToWorkspace = useStore(s => s.movePaneToWorkspace)
  const moveToNew = useStore(s => s.movePaneToNewWorkspace)
  const kind = useStore(s => s.workspaces[wsId]?.panes[paneId]?.config.kind)
  const recording = useStore(s => !!s.recording[paneId])
  // CONV-005 / REQ-013: the menu item's chord derives from the keybinding registry (never a literal),
  // mirroring PaneToolbar — so it tracks a rebind (FINDING-QUAL-002 / TEST-044). Select the STABLE
  // `quick.keybindings` ref and resolve in render: `resolveBindings(...)[id]` returns a fresh object
  // each call once an override exists, which as a zustand selector result loops forever (React #185).
  const keybindings = useStore(s => s.quick.keybindings)
  const bindings = resolveBindings(keybindings)
  const minChord = bindings['toggle-minimize-pane']
  const minTitle = minChord ? `Minimize pane (${formatChord(minChord)})` : 'Minimize pane'
  const findChord = bindings['find-in-terminal']
  const findTitle = findChord ? `Find in terminal (${formatChord(findChord)})` : 'Find in terminal'
  const clearChord = bindings['clear-terminal']
  const clearTitle = clearChord ? `Clear terminal and scrollback (${formatChord(clearChord)})` : 'Clear terminal and scrollback'
  const [view, setView] = useState<'root' | 'move'>('root')

  // Terminals open the terminal section (name + alerts + env); editors/explorers have no terminal
  // settings, so open Appearance — the section that applies to every pane kind.
  const settingsSection = kind === 'terminal' ? 'terminal' as const : 'appearance' as const
  const others = order.filter(id => id !== wsId)

  // portal: this menu opens from a pane's title bar, inside a react-mosaic tile (the MenuSurface
  // containing-block gotcha) — clientX/clientY coords and z-index must resolve against the page.
  return (
    <MenuSurface testid="pane-menu" onClose={onClose} portal
      style={{ left: x, top: y, padding: 4, gap: 2, minWidth: 160, fontSize: 'var(--font-size, 13px)' }}>
        {view === 'root' ? (
          <>
            <button data-testid="pane-menu-rename" onClick={() => { onClose(); onRename() }}>Rename</button>
            <button data-testid="pane-menu-minimize" title={minTitle}
              onClick={() => { toggleMinimize(wsId, paneId); onClose() }}>Minimize</button>
            {kind === 'terminal' && (
              <button data-testid="pane-menu-record"
                onClick={() => { recording ? api.recStop(paneId) : api.recStart(paneId); onClose() }}>
                {recording ? 'Stop recording' : 'Start recording'}</button>
            )}
            {kind === 'terminal' && (
              <button data-testid="pane-menu-find" title={findTitle}
                onClick={() => { onClose(); openPaneFind(paneId) }}>Find in terminal</button>
            )}
            {kind === 'terminal' && (
              <button data-testid="pane-menu-clear" title={clearTitle}
                onClick={() => { clearPane(paneId); onClose() }}>Clear terminal</button>
            )}
            <button data-testid="pane-menu-move" onClick={() => setView('move')}>Move to workspace ▸</button>
            <button data-testid="pane-menu-settings"
              onClick={() => { openSettings({ section: settingsSection, paneId }); onClose() }}>Settings</button>
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
    </MenuSurface>
  )
}
