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

export function buildInventory(list: readonly RawPaneInfo[]): InventoryPayload {
  const byWorkspace = new Map<string, InventoryWorkspace>()
  for (const p of list) {
    if (p.kind !== 'terminal') continue
    let ws = byWorkspace.get(p.workspaceId)
    if (!ws) {
      ws = { id: p.workspaceId, name: p.workspaceName, panes: [] }
      byWorkspace.set(p.workspaceId, ws)
    }
    ws.panes.push({ paneId: p.paneId, title: p.title, kind: p.kind, cols: p.cols, rows: p.rows, status: p.status })
  }
  return { workspaces: [...byWorkspace.values()] }
}
