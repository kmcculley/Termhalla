export interface CoreWindow {
  id: string
  isMain: boolean
  workspaceIds: string[]
  activeId: string | null
}
export interface CoreState { windows: CoreWindow[] }

export interface Point { x: number; y: number }
/** A window's tab-strip rectangle in screen coordinates. */
export interface Strip { windowId: string; x: number; y: number; width: number; height: number }

export type DropDecision =
  | { action: 'undock' }
  | { action: 'redock'; targetWindowId: string }
  | { action: 'none' }

export function windowOf(state: CoreState, workspaceId: string): string | null {
  return state.windows.find(w => w.workspaceIds.includes(workspaceId))?.id ?? null
}

/** Remove `workspaceId` from `w`, re-selecting its first remaining tab (or none) if it was active.
 *  The source-window update shared by undock and redock. */
function withoutWorkspace(w: CoreWindow, workspaceId: string): CoreWindow {
  const workspaceIds = w.workspaceIds.filter(id => id !== workspaceId)
  const activeId = w.activeId === workspaceId ? (workspaceIds[0] ?? null) : w.activeId
  return { ...w, workspaceIds, activeId }
}

/** Drop `workspaceId` into a brand-new window `newWindowId`. */
export function undock(state: CoreState, workspaceId: string, newWindowId: string): CoreState {
  const windows = state.windows.map(w =>
    w.workspaceIds.includes(workspaceId) ? withoutWorkspace(w, workspaceId) : w)
  windows.push({ id: newWindowId, isMain: false, workspaceIds: [workspaceId], activeId: workspaceId })
  return { windows }
}

/** Move `workspaceId` into `targetWindowId`; close the source window if it is a now-empty
 *  non-main window. Returns the closed window id (if any) so the shell can destroy it. */
export function redock(
  state: CoreState, workspaceId: string, targetWindowId: string
): { state: CoreState; closedWindowId: string | null } {
  const sourceId = windowOf(state, workspaceId)
  let windows = state.windows.map(w => {
    if (w.id === sourceId) return withoutWorkspace(w, workspaceId)
    if (w.id === targetWindowId) {
      return { ...w, workspaceIds: [...w.workspaceIds, workspaceId], activeId: workspaceId }
    }
    return w
  })
  const source = windows.find(w => w.id === sourceId)
  let closedWindowId: string | null = null
  if (source && !source.isMain && source.workspaceIds.length === 0 && sourceId !== targetWindowId) {
    closedWindowId = source.id
    windows = windows.filter(w => w.id !== sourceId)
  }
  return { state: { windows }, closedWindowId }
}

function inStrip(p: Point, s: Strip): boolean {
  return p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height
}

/** Decide what a tab drop means given the cursor, the dragged tab's source window, and every
 *  window's strip rect. Over no strip -> undock; over another window's strip -> redock; over its
 *  own strip -> none. */
export function decideDrop(cursor: Point, sourceWindowId: string, strips: Strip[]): DropDecision {
  const hit = strips.find(s => inStrip(cursor, s))
  if (!hit) return { action: 'undock' }
  if (hit.windowId === sourceWindowId) return { action: 'none' }
  return { action: 'redock', targetWindowId: hit.windowId }
}
