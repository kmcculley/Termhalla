import type { Workspace } from './types'
import { deserializeWorkspace, remapPaneIds } from './workspace-model'

/** The file extension for a portable Termhalla workspace document (a "save a workspace to a file
 *  you can share/back up" artifact). The on-disk contents are exactly `serializeWorkspace(ws)` —
 *  the same versioned `{ schemaVersion, workspace }` envelope the internal per-workspace store
 *  writes — so a document and an internal record are byte-identical; only the *location* differs. */
export const WORKSPACE_DOC_EXT = 'thws'

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

/** Suggest a filename for a workspace document from its name: a filesystem-safe basename plus the
 *  `.thws` extension. Illegal path characters collapse to `-`; a blank name falls back to
 *  `workspace`. Pure so the dialog's default path can be derived without touching disk. */
export function defaultDocName(workspaceName: string): string {
  const base = workspaceName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  return `${base || 'workspace'}.${WORKSPACE_DOC_EXT}`
}

/** Instantiate a fresh, independent workspace from the JSON contents of a `.thws` document.
 *
 *  Unlike reopening a *closed internal* workspace (which keeps its identity — same workspace id,
 *  same pane ids — so it re-adopts any still-live PTYs), opening a *document* mints a brand-new
 *  workspace id and fresh pane ids. That way the same file can be opened while a prior instance is
 *  still open (or opened twice) without pane-id collisions, exactly like `workspaceFromTemplate`.
 *
 *  Reuses `deserializeWorkspace` for all validation/migration/normalization (bad JSON, a newer
 *  schema, a hostile `orky` binding or `home` all surface identically to loading any other record),
 *  then re-keys every pane. Because the re-key changes ids, the persisted `minimized`/`maximized`
 *  view-state references are remapped through the same id map so a saved-minimized pane reopens
 *  minimized rather than dangling. Per-pane reconnection config — `cwd`, the SSH `launch`, the
 *  Claude/Codex `resumeAi` hint — rides along inside each pane's config untouched. Throws (via
 *  `deserializeWorkspace`) on invalid/newer input; callers surface that as a toast. */
export function importWorkspaceDoc(json: string, newWorkspaceId: string, uuid: () => string): Workspace {
  const src = deserializeWorkspace(json)
  const { layout, panes, idMap } = remapPaneIds(src.layout, src.panes, uuid)
  const out: Workspace = { id: newWorkspaceId, name: src.name, layout, panes }
  if (src.theme) out.theme = clone(src.theme)
  if (src.runCommands) out.runCommands = clone(src.runCommands)
  if (src.home) out.home = clone(src.home)
  const minimized = (src.minimized ?? [])
    .map(id => idMap.get(id))
    .filter((id): id is string => typeof id === 'string')
  if (minimized.length) out.minimized = minimized
  const maximized = src.maximized ? idMap.get(src.maximized) : undefined
  if (maximized) out.maximized = maximized
  return out
}
