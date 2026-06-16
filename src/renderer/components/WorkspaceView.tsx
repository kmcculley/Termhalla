import { Mosaic } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'
import { PaneTile } from './PaneTile'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)

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
      renderTile={(paneId, path) => <PaneTile wsId={ws.id} paneId={paneId} path={path} />}
    />
  )
}
