/**
 * Pure per-workspace view-state map helpers (2026-07-17 quality audit, Finding 25). The two
 * manipulations below each existed as copy-pasted blocks that had ALREADY drifted:
 *  - remove-pane-from-minimized appeared verbatim in movePaneToWorkspace and closePane;
 *  - derive-view-state-from-record differed between applyAssignment
 *    (`Array.isArray(ws.minimized) && ws.minimized.length`) and registerWorkspacePatch
 *    (`ws.minimized?.length`) — the latter would have stored a corrupt non-array truthy value
 *    into the string[] map. Unified here on the Array.isArray form.
 * Api-free (no ../api import) so it stays unit-testable under the node harness.
 */
import type { Workspace } from '@shared/types'

/** Remove `paneId` from `wsId`'s minimized list, deleting the key when the list empties (the
 *  runtime maps never hold empty arrays). Returns a NEW map; the input is never mutated. */
export function removeFromMinimized(
  minimized: Record<string, string[]>, wsId: string, paneId: string
): Record<string, string[]> {
  const next = { ...minimized }
  const rest = (next[wsId] ?? []).filter(id => id !== paneId)
  if (rest.length) next[wsId] = rest; else delete next[wsId]
  return next
}

/** Derive a workspace record's persisted view-state (minimized/maximized) into the given
 *  runtime-map COPIES: set the workspace's entry from the record, or clear a stale one when the
 *  record carries none (the re-adopt case). Mutates the passed copies — callers own them (both
 *  call sites already hold `{ ...s.minimized }` spreads). The ONE derive shared by
 *  registerWorkspacePatch and applyAssignment. */
export function deriveViewStateInto(
  minimized: Record<string, string[]>, maximized: Record<string, string>, ws: Workspace
): void {
  if (Array.isArray(ws.minimized) && ws.minimized.length) minimized[ws.id] = ws.minimized
  else delete minimized[ws.id]
  if (typeof ws.maximized === 'string') maximized[ws.id] = ws.maximized
  else delete maximized[ws.id]
}
