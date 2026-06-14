import type {
  Workspace, PaneConfig, MosaicNode, MosaicParent, MosaicDirection
} from '@shared/types'
import { SCHEMA_VERSION } from '@shared/types'

type IdGen = () => string

export function createWorkspace(name: string, id: IdGen): Workspace {
  return { id: id(), name, layout: null, panes: {} }
}

export function addFirstPane(ws: Workspace, config: PaneConfig, id: IdGen) {
  const paneId = id()
  const workspace: Workspace = {
    ...ws,
    layout: paneId,
    panes: { ...ws.panes, [paneId]: { paneId, config } }
  }
  return { workspace, paneId }
}

function replaceLeaf(node: MosaicNode, target: string, replacement: MosaicNode): MosaicNode {
  if (node === target) return replacement
  if (typeof node === 'string') return node
  return { ...node, first: replaceLeaf(node.first, target, replacement),
                     second: replaceLeaf(node.second, target, replacement) }
}

export function splitPane(
  ws: Workspace, targetPaneId: string, direction: MosaicDirection,
  config: PaneConfig, id: IdGen
) {
  if (ws.layout === null) return addFirstPane(ws, config, id)
  const paneId = id()
  const parent: MosaicParent = { direction, first: targetPaneId, second: paneId }
  const layout = replaceLeaf(ws.layout, targetPaneId, parent)
  const workspace: Workspace = {
    ...ws, layout,
    panes: { ...ws.panes, [paneId]: { paneId, config } }
  }
  return { workspace, paneId }
}

function removeLeaf(node: MosaicNode, target: string): MosaicNode | null {
  if (node === target) return null
  if (typeof node === 'string') return node
  const first = removeLeaf(node.first, target)
  const second = removeLeaf(node.second, target)
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}

export function removePane(ws: Workspace, paneId: string): Workspace {
  const layout = ws.layout === null ? null : removeLeaf(ws.layout, paneId)
  const panes = { ...ws.panes }
  delete panes[paneId]
  return { ...ws, layout, panes }
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, workspace: ws }, null, 2)
}

export function deserializeWorkspace(json: string): Workspace {
  const data = JSON.parse(json)
  if (typeof data?.schemaVersion !== 'number' || !data.workspace) {
    throw new Error('Invalid workspace file: missing schemaVersion/workspace')
  }
  const ws = migrate(data.workspace, data.schemaVersion)
  if (typeof ws.id !== 'string' || typeof ws.panes !== 'object') {
    throw new Error('Invalid workspace file: bad shape')
  }
  return ws
}

// Future versions add cases here; v1 is identity.
function migrate(ws: Workspace, version: number): Workspace {
  if (version > SCHEMA_VERSION) {
    throw new Error(`Workspace schemaVersion ${version} is newer than supported (${SCHEMA_VERSION})`)
  }
  return ws
}
