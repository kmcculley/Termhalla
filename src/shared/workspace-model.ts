import type {
  Workspace, PaneConfig, MosaicNode, MosaicParent, MosaicDirection, SplitDir4, PaneNode, WorkspaceTemplate
} from '@shared/types'
import { SCHEMA_VERSION } from '@shared/types'
import { normalizeWorkspaceHome } from './remote-home'

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
  config: PaneConfig, id: IdGen, position: 'before' | 'after' = 'after'
) {
  if (ws.layout === null) return addFirstPane(ws, config, id)
  const paneId = id()
  // 'after' (default) keeps today's shape byte-for-byte: target stays `first`, new pane is `second`.
  // 'before' only swaps which child is new — the node stays a { direction, first, second } parent,
  // so persisted layouts deserialize unchanged (no SCHEMA_VERSION bump).
  const parent: MosaicParent = position === 'before'
    ? { direction, first: paneId, second: targetPaneId }
    : { direction, first: targetPaneId, second: paneId }
  const layout = replaceLeaf(ws.layout, targetPaneId, parent)
  const workspace: Workspace = {
    ...ws, layout,
    panes: { ...ws.panes, [paneId]: { paneId, config } }
  }
  return { workspace, paneId }
}

/** Map a compass UI direction to the orientation + insertion position `splitPane` needs.
 *  right → { row, after }, down → { column, after }, left → { row, before }, up → { column, before }.
 *  Pure and unit-tested (TEST-005) so the store can thread the geometry without re-deriving it. */
export function splitDirToLayout(dir: SplitDir4): { direction: MosaicDirection; position: 'before' | 'after' } {
  switch (dir) {
    case 'right': return { direction: 'row', position: 'after' }
    case 'left': return { direction: 'row', position: 'before' }
    case 'down': return { direction: 'column', position: 'after' }
    case 'up': return { direction: 'column', position: 'before' }
  }
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
  // Prune the pane's view-state so a closed/moved pane leaves no orphan reference (REQ-017).
  return pruneViewState({ ...ws, layout, panes }, paneId)
}

/** Drop `paneId` from a workspace's persisted view-state: remove it from `minimized` and clear
 *  `maximized` if it held it. Used by removePane and the cross-workspace move so no view-state
 *  entry dangles past the pane it referenced. */
function pruneViewState(ws: Workspace, paneId: string): Workspace {
  let next = ws
  if (ws.minimized?.includes(paneId)) next = { ...next, minimized: ws.minimized.filter(id => id !== paneId) }
  if (ws.maximized === paneId) next = { ...next, maximized: null }
  return next
}

/** The visible layout = `ws.layout` with every minimized leaf pruned so the remaining panes reflow
 *  to fill the freed area (REQ-002). Returns `null` when every pane is minimized (the all-minimized
 *  empty-state branch, REQ-011). Pure — the reflow source of truth the renderer feeds to <Mosaic>. */
export function computeVisibleLayout(ws: Workspace): MosaicNode | null {
  let layout: MosaicNode | null = ws.layout
  if (layout === null) return null
  for (const id of ws.minimized ?? []) {
    if (layout === null) break
    layout = removeLeaf(layout, id)
  }
  return layout
}

/** Minimize a pane: add it to `minimized` (idempotent — no duplicate) and, per the minimize↔maximize
 *  mutual exclusion (REQ-010), clear `maximized` iff this pane held it. The pane stays in `panes` and
 *  in `layout` — it is only pruned from the *visible* tree by computeVisibleLayout, so it remains
 *  alive off-layout (kept-mounted). No-op (returns the same ref) on an unknown or already-minimized
 *  pane (REQ-017).
 *
 *  NOTE (split-state contract, QUAL-003): this pure reducer writes `ws.minimized` on the record, but
 *  the runtime store does NOT call it — the live minimize/maximize state is the store's per-workspace
 *  `minimized`/`maximized` maps (store.ts `toggleMinimize`/`toggleMaximize`), folded back onto the
 *  record only at save time (`applyViewState`). So a workspace record's `minimized`/`maximized` fields
 *  are stale in memory between save/load. This function is the pure-reducer / unit-test surface
 *  (mirrors the store's precedence so the two agree); it is not a store action. */
export function minimizePane(ws: Workspace, paneId: string): Workspace {
  if (!ws.panes[paneId]) return ws
  const minimized = ws.minimized ?? []
  if (minimized.includes(paneId)) return ws
  const next: Workspace = { ...ws, minimized: [...minimized, paneId] }
  if (ws.maximized === paneId) next.maximized = null
  return next
}

/** Restore a minimized pane: drop it from `minimized` and re-insert it into the visible layout split
 *  to the RIGHT of the current visible layout — `{ direction:'row', first:<prev visible>, second:paneId }`
 *  (mirrors movePane), or as the sole leaf when the visible layout was empty (all-minimized branch).
 *  The pane id is unchanged so its live PTY is re-adopted by the idempotent pty:spawn (REQ-006).
 *  No-op (same ref) when the pane is unknown or not minimized (REQ-017). */
export function restorePane(ws: Workspace, paneId: string): Workspace {
  const minimized = ws.minimized ?? []
  if (!ws.panes[paneId] || !minimized.includes(paneId)) return ws
  const nextMin = minimized.filter(id => id !== paneId)
  // Base = the visible layout with this pane removed (it may still linger in ws.layout) AND the
  // remaining minimized panes pruned, so the restored pane lands as a clean right split.
  let base: MosaicNode | null = ws.layout === null ? null : removeLeaf(ws.layout, paneId)
  for (const id of nextMin) {
    if (base === null) break
    base = removeLeaf(base, id)
  }
  const layout: MosaicNode = base === null ? paneId : { direction: 'row', first: base, second: paneId }
  return { ...ws, layout, minimized: nextMin }
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
  // The moved pane lands in the destination's VISIBLE layout — clear any stale view-state for it so
  // it is never minimized/maximized on arrival (REQ-015: avoids an unreachable mid-move pane).
  const nextTo: Workspace = pruneViewState({ ...to, layout, panes: { ...to.panes, [paneId]: pane } }, paneId)
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
  // `typeof` alone admits null and arrays (both 'object') — reject them here so a corrupt/hostile
  // file gets the actionable bad-shape error instead of a raw TypeError downstream.
  if (typeof ws.id !== 'string' || ws.panes === null || typeof ws.panes !== 'object' || Array.isArray(ws.panes)) {
    throw new Error('Invalid workspace file: bad shape')
  }
  return normalizeHome(normalizeViewState(normalizeOrkyBindings(ws)))
}

// Future versions add cases here; v1 is identity.
function migrate(ws: Workspace, version: number): Workspace {
  if (version > SCHEMA_VERSION) {
    throw new Error(`Workspace schemaVersion ${version} is newer than supported (${SCHEMA_VERSION})`)
  }
  let w = ws
  // v6 -> v7: persisted pane view-state (minimized/maximized) was introduced. A pre-v7 record has
  // none, so it loads with empty view-state — never an identity that leaves the fields undefined to
  // be guessed at downstream (REQ-009: explicit, no silent data loss).
  if (version < 7) w = { ...w, minimized: [], maximized: null }
  // v7 -> v8 (feature 0009, REQ-002): the persisted `orky` pane kind joined PaneConfig. This step
  // is a DOCUMENTED IDENTITY — a pre-v8 record cannot contain an `orky` pane, so no field is
  // rewritten. The bump exists so a pre-v8 build rejects a v8 file via the "newer than supported"
  // guard above instead of loading a pane kind it cannot render.
  if (version < 8) w = { ...w }
  // v8 -> v9 (feature 0022, REQ-002): the persisted per-workspace `home` joined the Workspace
  // record. This step is a DOCUMENTED IDENTITY — a pre-v9 record cannot contain a `home`, so no
  // field is rewritten. The bump exists so a pre-v9 build rejects a v9 file via the "newer than
  // supported" guard above instead of silently DROPPING the home and spawning panes meant for a
  // remote machine as local shells.
  if (version < 9) w = { ...w }
  return w
}

/** Load tolerance for a malformed persisted `orky` binding (feature 0009, REQ-020): an `orky` pane
 *  whose `config.root` is missing or non-string is coerced to `''` — the tolerated unbound-on-load
 *  value — so downstream code never sees a non-string binding and the pane renders the explicit
 *  unbound state instead of being dropped or throwing (CONV-002). Applied at EVERY instantiation
 *  path of the persisted shape (FINDING-032): workspace-file load (`deserializeWorkspace`, the
 *  `normalizeViewState` precedent — migrated output passes through it too) AND template
 *  instantiation (`workspaceFromTemplate` — `quick.json` templates are validated only as an array,
 *  so a hand-edited template is exactly the hostile input this seam exists for). A well-formed
 *  binding (and every non-orky pane) passes through untouched, keeping the serialize→deserialize
 *  round trip byte-identical (REQ-002). */
/** Load tolerance for the persisted per-workspace `home` (feature 0022, REQ-001): the field is
 *  re-derived through `normalizeWorkspaceHome` at EVERY deserialization path (CONV-026 —
 *  workspace-file load AND template instantiation). A well-formed home (and every home-less
 *  workspace) passes through with the SAME object reference, keeping the serialize→deserialize
 *  round trip byte-identical (REQ-002). */
function normalizeHome(ws: Workspace): Workspace {
  const norm = normalizeWorkspaceHome(ws.home)
  if (norm === undefined) {
    if (ws.home === undefined) return ws
    const next = { ...ws }
    delete next.home
    return next
  }
  const cur = ws.home as { kind?: unknown; agentId?: unknown; agentName?: unknown } | undefined
  const identical = !!cur && cur.kind === norm.kind && cur.agentId === norm.agentId &&
    cur.agentName === norm.agentName && Object.keys(cur).length === 3
  return identical ? ws : { ...ws, home: norm }
}

function normalizeOrkyBindings(ws: Workspace): Workspace {
  let panes = ws.panes
  let changed = false
  for (const id of Object.keys(ws.panes ?? {})) {
    const pane = ws.panes[id]
    const cfg = pane?.config as { kind?: unknown; root?: unknown } | undefined
    if (!cfg || cfg.kind !== 'orky' || typeof cfg.root === 'string') continue
    if (!changed) { panes = { ...ws.panes }; changed = true }
    panes[id] = { ...pane, config: { ...(pane.config as object), root: '' } as PaneConfig }
  }
  return changed ? { ...ws, panes } : ws
}

/** Normalize a workspace's persisted view-state on load: drop dangling paneId references (an entry
 *  not present in `panes`), tolerate a malformed shape by collapsing it to empty (no throw), and
 *  impose NO cap on the minimized list (CONV-002/CONV-003, REQ-009). Pure and total. Empty view-state
 *  is represented by ABSENT fields (not `[]`/`null`) so a workspace with no minimized/maximized panes
 *  round-trips byte-identical — readers treat an absent field as empty (`?? []` / `?? null`). */
function normalizeViewState(ws: Workspace): Workspace {
  const ids = new Set(Object.keys(ws.panes ?? {}))
  const minimized = Array.isArray(ws.minimized)
    ? ws.minimized.filter(id => typeof id === 'string' && ids.has(id))
    : []
  // REQ-010 mutual exclusion on the LOAD path: a record with the same valid pane in BOTH fields is
  // incoherent — minimize wins (the same precedence `minimizePane` uses), so runtime and load agree
  // and a pane is never loaded as minimized AND maximized at once (FINDING-CODEX-002 / TEST-039).
  const maximized = typeof ws.maximized === 'string' && ids.has(ws.maximized) && !minimized.includes(ws.maximized)
    ? ws.maximized : null
  const next = { ...ws }
  if (minimized.length) next.minimized = minimized; else delete next.minimized
  if (maximized !== null) next.maximized = maximized; else delete next.maximized
  return next
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

/** Re-key every pane with a fresh id, rewriting the layout-tree leaves and the panes map. Returns
 *  the `idMap` (old→new) too so callers that carry pane-id *references* elsewhere (e.g. a workspace
 *  document's `minimized`/`maximized` view-state) can remap those references consistently. */
export function remapPaneIds(
  layout: MosaicNode | null,
  panes: Record<string, PaneNode>,
  uuid: () => string
): { layout: MosaicNode | null; panes: Record<string, PaneNode>; idMap: Map<string, string> } {
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
  return { layout: layout === null ? null : remapNode(layout), panes: newPanes, idMap }
}

/** Capture a workspace's layout as a (deep-copied) template blueprint, including its
 *  workspace-level theme override (pane-level overrides ride along inside `panes`). */
export function templateFromWorkspace(ws: Workspace, id: string, name: string): WorkspaceTemplate {
  return {
    id, name,
    layout: ws.layout === null ? null : cloneConfig(ws.layout),
    panes: cloneConfig(ws.panes),
    theme: ws.theme ? cloneConfig(ws.theme) : undefined,
    runCommands: ws.runCommands ? cloneConfig(ws.runCommands) : undefined,
    // Per-workspace home (feature 0022): a template saved from a remote workspace re-instantiates
    // remote (normalized again at instantiation — CONV-026).
    ...(ws.home ? { home: cloneConfig(ws.home) } : {})
  }
}

/** Instantiate a fresh workspace from a template (new pane ids), restoring its theme override.
 *  The instantiated panes pass through the SAME malformed-orky-binding coercion the workspace-file
 *  loader applies (REQ-020 / FINDING-032): `quick.json`'s loader validates templates only as
 *  `Array.isArray`, and `remapPaneIds` clones configs opaquely — without this seam a hand-edited
 *  template's non-string `root` would reach the renderer verbatim and throw at render time. */
export function workspaceFromTemplate(tpl: WorkspaceTemplate, wsId: string, name: string, uuid: () => string): Workspace {
  const { layout, panes } = remapPaneIds(tpl.layout, tpl.panes, uuid)
  // The template's `home` rides the SAME normalization as the workspace-file loader (feature 0022,
  // REQ-001/CONV-026): quick.json templates are validated only as an array, so a hand-edited home
  // is exactly the hostile input this seam exists for.
  const home = normalizeWorkspaceHome((tpl as { home?: unknown }).home)
  return normalizeHome(normalizeOrkyBindings({
    id: wsId, name, layout, panes,
    theme: tpl.theme ? cloneConfig(tpl.theme) : undefined,
    runCommands: tpl.runCommands ? cloneConfig(tpl.runCommands) : undefined,
    ...(home ? { home } : {})
  }))
}
