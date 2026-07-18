/**
 * The workspace-grouped terminal-pane inventory (feature 0026, REQ-011) — a pure builder over the
 * flat pane list `PhoneRemoteServiceDeps.panes.list()` returns. Non-terminal pane kinds (editor,
 * explorer, orky, notes) are excluded from v1; local and remote-workspace terminal panes are
 * listed identically (the seam is source-agnostic, matching the mirror-manager fan-out).
 */

export interface RawPaneInfo {
  paneId: string
  workspaceId: string
  workspaceName: string
  title: string
  kind: string
  cols: number
  rows: number
  status: string
}

export interface InventoryPane {
  paneId: string
  title: string
  kind: string
  cols: number
  rows: number
  status: string
}

export interface InventoryWorkspace {
  id: string
  name: string
  panes: InventoryPane[]
}

export interface InventoryPayload {
  workspaces: InventoryWorkspace[]
}

/** A human-readable fallback for a missing/blank title, or one that (by construction error) still
 *  equals the raw internal pane id — REQ-011 forbids ever showing the raw id. Distinct siblings of
 *  the same kind in the same workspace get distinguishable labels via a per-(workspace,kind)
 *  running index, counted over every pane of that kind (not only the ones needing a fallback), so
 *  the numbering stays stable as more panes are added. */
const humanTitle = (title: string, paneId: string, kind: string, index: number): string => {
  const trimmed = typeof title === 'string' ? title.trim() : ''
  if (trimmed && trimmed !== paneId) return trimmed
  return `${kind} ${index}`
}

export function buildInventory(list: readonly RawPaneInfo[]): InventoryPayload {
  const byWorkspace = new Map<string, InventoryWorkspace>()
  const kindIndex = new Map<string, number>() // `${workspaceId}:${kind}` -> next index
  for (const p of list) {
    if (p.kind !== 'terminal') continue
    let ws = byWorkspace.get(p.workspaceId)
    if (!ws) {
      ws = { id: p.workspaceId, name: p.workspaceName, panes: [] }
      byWorkspace.set(p.workspaceId, ws)
    }
    const key = `${p.workspaceId}:${p.kind}`
    const index = (kindIndex.get(key) ?? 0) + 1
    kindIndex.set(key, index)
    const title = humanTitle(p.title, p.paneId, p.kind, index)
    ws.panes.push({ paneId: p.paneId, title, kind: p.kind, cols: p.cols, rows: p.rows, status: p.status })
  }
  return { workspaces: [...byWorkspace.values()] }
}
