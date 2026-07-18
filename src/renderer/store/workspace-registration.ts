import type { Workspace } from '@shared/types'
import { deriveViewStateInto } from './view-state'

/** The slice of store state the registration ritual touches (structurally a subset of State,
 *  kept minimal so this module stays importable under vitest's node env — no ../api). */
export interface WorkspaceRegistrationState {
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  minimized: Record<string, string[]>
  maximized: Record<string, string>
}

/** Pure state transition for registering a workspace record into a window: add/replace the record,
 *  append to order (idempotently — re-adopting an open id must not duplicate the tab), make it the
 *  active tab, and derive its persisted view-state (minimized/maximized) into the runtime maps
 *  exactly like applyAssignment does on load. */
export function registerWorkspacePatch(s: WorkspaceRegistrationState, ws: Workspace): WorkspaceRegistrationState {
  const order = s.order.includes(ws.id) ? s.order : [...s.order, ws.id]
  const minimized = { ...s.minimized }
  const maximized = { ...s.maximized }
  // The ONE shared derive (view-state.ts) — applyAssignment folds newly loaded records through the
  // same helper, so the two sites can never drift again (2026-07-17 audit, Finding 25).
  deriveViewStateInto(minimized, maximized, ws)
  return { workspaces: { ...s.workspaces, [ws.id]: ws }, order, activeId: ws.id, minimized, maximized }
}

export interface RegistrationDeps<S extends WorkspaceRegistrationState> {
  set: (fn: (s: S) => WorkspaceRegistrationState) => void
  scheduleAutosave: () => void
  reportAssignment: () => void
}

/** The ONE workspace-registration ritual: patch state, schedule the autosave, then report the new
 *  arrangement into main's authoritative windows[]. Every site that adds a workspace to a window
 *  (newWorkspace / newOrkyWorkspace / newRemoteWorkspace / newWorkspaceFromTemplate /
 *  adoptWorkspace) must route through this — the report is load-bearing (0011 FINDING-001: an
 *  unreported workspace is silently deleted by the next pushed assignment and lost across
 *  quit→relaunch), and hand-rolled copies are exactly how that bug shipped. */
export function makeRegisterWorkspace<S extends WorkspaceRegistrationState>(
  deps: RegistrationDeps<S>
): (ws: Workspace) => void {
  return (ws) => {
    deps.set(s => registerWorkspacePatch(s, ws))
    deps.scheduleAutosave()
    deps.reportAssignment()
  }
}
