import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { useStore } from '../store'
import { TerminalPane } from './TerminalPane'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)

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
        return (
          <MosaicWindow<string>
            path={path}
            title={pane?.config.name ?? 'Terminal'}
            toolbarControls={[
              <button key="split" data-testid={`split-${paneId}`}
                onClick={() => addTerminal(ws.id, paneId, 'row')}>Split</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
          >
            {pane ? <TerminalPane paneId={paneId} config={pane.config} /> : <div>missing pane</div>}
          </MosaicWindow>
        )
      }}
    />
  )
}
