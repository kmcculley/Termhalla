import type {
  Workspace, PaneConfig, MosaicNode, MosaicParent, MosaicDirection, PaneNode, WorkspaceTemplate
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

/** Move a pane (with its config + any per-pane theme) from one workspace to another, returning
 *  both updated workspaces. The pane is removed from `from`'s layout and added to `to` — as the
 *  sole pane when `to` is empty, otherwise split to the right of `to`'s current layout. No-op
 *  (returns the same objects) when `from` doesn't hold the pane. The pane id is unchanged, so its
 *  live PTY (kept in main) is re-adopted by the destination's idempotent pty:spawn. */
export function movePane(from: Workspace, to: Workspace, paneId: string): { from: Workspace; to: Workspace } {
  const pane = from.panes[paneId]
  if (!pane) return { from, to }
  const nextFrom = removePane(from, paneId)
  const layout: MosaicNode = to.layout === null ? paneId : { direction: 'row', first: to.layout, second: paneId }
  const nextTo: Workspace = { ...to, layout, panes: { ...to.panes, [paneId]: pane } }
  return { from: nextFrom, to: nextTo }
}

/** Copy `source`'s workspace-level theme override onto `target` (deep-cloned), so a pane moved into
 *  a freshly created `target` renders the same as it did in `source`. Returns `target` unchanged
 *  when `source` has no override. */
export function carryTheme(target: Workspace, source: Workspace): Workspace {
  return source.theme ? { ...target, theme: { ...source.theme } } : target
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, workspace: ws }, null, 2)
}

export function deserializeWorkspace(json: string): Workspace {
  let data: { schemaVersion?: unknown; workspace?: Workspace }
  try { data = JSON.parse(json) }
  catch { throw new Error('Invalid workspace file: not valid JSON') }
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

/** Move `fromId` to the index currently held by `toId`, returning a new array.
 *  No-op when either id is missing or they are equal. */
export function reorderIds(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

function cloneConfig<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

/** Re-key every pane with a fresh id, rewriting the layout-tree leaves and the panes map. */
export function remapPaneIds(
  layout: MosaicNode | null,
  panes: Record<string, PaneNode>,
  uuid: () => string
): { layout: MosaicNode | null; panes: Record<string, PaneNode> } {
  const idMap = new Map<string, string>()
  for (const oldId of Object.keys(panes)) idMap.set(oldId, uuid())
  const remapNode = (node: MosaicNode): MosaicNode =>
    typeof node === 'string'
      ? (idMap.get(node) ?? node)
      : { ...node, first: remapNode(node.first), second: remapNode(node.second) }
  const newPanes: Record<string, PaneNode> = {}
  for (const [oldId, pane] of Object.entries(panes)) {
    const newId = idMap.get(oldId)!
    newPanes[newId] = { paneId: newId, config: cloneConfig(pane.config) }
  }
  return { layout: layout === null ? null : remapNode(layout), panes: newPanes }
}

/** Capture a workspace's layout as a (deep-copied) template blueprint, including its
 *  workspace-level theme override (pane-level overrides ride along inside `panes`). */
export function templateFromWorkspace(ws: Workspace, id: string, name: string): WorkspaceTemplate {
  return {
    id, name,
    layout: ws.layout === null ? null : cloneConfig(ws.layout),
    panes: cloneConfig(ws.panes),
    theme: ws.theme ? cloneConfig(ws.theme) : undefined,
    runCommands: ws.runCommands ? cloneConfig(ws.runCommands) : undefined
  }
}

/** Instantiate a fresh workspace from a template (new pane ids), restoring its theme override. */
export function workspaceFromTemplate(tpl: WorkspaceTemplate, wsId: string, name: string, uuid: () => string): Workspace {
  const { layout, panes } = remapPaneIds(tpl.layout, tpl.panes, uuid)
  return {
    id: wsId, name, layout, panes,
    theme: tpl.theme ? cloneConfig(tpl.theme) : undefined,
    runCommands: tpl.runCommands ? cloneConfig(tpl.runCommands) : undefined
  }
}
