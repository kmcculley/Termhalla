import { useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'
import { api } from '../api'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { TerminalSettings } from './TerminalSettings'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const closePane = useStore(s => s.closePane)
  const statuses = useStore(s => s.statuses)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)

  if (ws.layout === null) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>+ Terminal</button>
          <button data-testid="add-first-editor" onClick={() => addEditor(ws.id, null, 'row')}>+ Editor</button>
          <button data-testid="add-first-explorer" onClick={async () => { const r = await api.openFolder(); if (r) addExplorer(ws.id, null, 'row', r) }}>+ Explorer</button>
        </div>
      </div>
    )
  }

  return (
    <Mosaic<string>
      value={ws.layout as ModelNode & string}
      onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
      renderTile={(paneId, path) => {
        const pane = ws.panes[paneId]
        const termCfg = pane?.config.kind === 'terminal' ? pane.config : undefined
        const status = statuses[paneId]
        const alerts = resolveAlerts(termCfg?.alerts)
        const state = status?.state ?? 'idle'
        const statusClass = alerts.border ? `term-status term-${state}` +
          (state === 'idle' && status?.lastExit ? ` term-exit-${status.lastExit}` : '') : ''
        const needsInput = state === 'needs-input'
        const title = (needsInput ? '🔔 ' : '') + (termCfg?.name ?? pane?.config.kind ?? 'Pane')
        return (
          <MosaicWindow<string>
            path={path}
            title={title}
            className={statusClass}
            toolbarControls={[
              <button key="gear" data-testid={`gear-${paneId}`} title="Terminal settings"
                onClick={() => setSettingsFor(settingsFor === paneId ? null : paneId)}>⚙</button>,
              <button key="split-row" data-testid={`split-${paneId}`} title="Split right"
                onClick={() => addTerminal(ws.id, paneId, 'row')}>⬌</button>,
              <button key="split-col" data-testid={`split-col-${paneId}`} title="Split down"
                onClick={() => addTerminal(ws.id, paneId, 'column')}>⬍</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
          >
            <div className="term-tile" data-status={state}
              data-testid={`tile-${paneId}`} style={{ position: 'relative', height: '100%' }}>
              {settingsFor === paneId && pane && termCfg && (
                <TerminalSettings config={termCfg}
                  onChange={patch => updatePaneConfig(ws.id, paneId, patch)}
                  onClose={() => setSettingsFor(null)} />
              )}
              {pane?.config.kind === 'terminal' && termCfg && <TerminalPane paneId={paneId} config={termCfg} />}
              {pane?.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={ws.id} config={pane.config} />}
              {pane?.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={ws.id} config={pane.config} />}
              {!pane && <div>missing pane</div>}
            </div>
          </MosaicWindow>
        )
      }}
    />
  )
}
