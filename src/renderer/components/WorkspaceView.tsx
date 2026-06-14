import { useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'
import { TerminalPane } from './TerminalPane'
import { TerminalSettings } from './TerminalSettings'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)
  const statuses = useStore(s => s.statuses)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)

  if (ws.layout === null) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>
          + New Terminal
        </button>
      </div>
    )
  }

  return (
    <Mosaic<string>
      value={ws.layout as ModelNode & string}
      onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
      renderTile={(paneId, path) => {
        const pane = ws.panes[paneId]
        const status = statuses[paneId]
        const alerts = resolveAlerts(pane?.config.alerts)
        const state = status?.state ?? 'idle'
        const borderClass = alerts.border ? ` term-border term-${state}` +
          (state === 'idle' && status?.lastExit ? ` term-exit-${status.lastExit}` : '') : ''
        const needsInput = state === 'needs-input'
        return (
          <MosaicWindow<string>
            path={path}
            title={(needsInput ? '🔔 ' : '') + (pane?.config.name ?? 'Terminal')}
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
            <div className={`term-tile${borderClass}`} data-status={state}
              data-testid={`tile-${paneId}`} style={{ position: 'relative', height: '100%' }}>
              {settingsFor === paneId && pane && (
                <TerminalSettings config={pane.config}
                  onChange={patch => updatePaneConfig(ws.id, paneId, patch)}
                  onClose={() => setSettingsFor(null)} />
              )}
              {pane ? <TerminalPane paneId={paneId} config={pane.config} /> : <div>missing pane</div>}
            </div>
          </MosaicWindow>
        )
      }}
    />
  )
}
