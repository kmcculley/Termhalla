/**
 * Per-pane Explorer view-state stash, mirroring `terminal-registry.ts` (the terminal-snapshot stash)
 * and `pane-transit.ts` (the editor-draft flush). Minimize/restore prunes the Explorer pane's leaf
 * from the visible mosaic and re-renders the body in the off-layout host (then back in the tile on
 * restore), so React UNMOUNTS the ExplorerPane and MOUNTS a fresh instance — discarding its LOCAL
 * React state (which folders are expanded, scroll position). To preserve it "like any kept-mounted
 * pane" (REQ-012 / FINDING-DA-001) the store stashes the about-to-unmount instance's view-state here
 * before the transition; the remounting instance consumes it on mount and rehydrates.
 *
 * This holds ONLY paneId-scoped UI state (expanded folder paths + scroll offset) in renderer memory.
 * It is NEVER persisted to disk and carries no file content / secrets — REQ-016 (ids/flags only)
 * stays intact; this is purely the renderer transit bridge, the sibling of the terminal snapshot.
 */
export interface ExplorerViewState {
  /** Absolute paths of the folders currently expanded (always includes the root). */
  expanded: string[]
  /** The scroll container's scrollTop, so a long tree restores to the same position. */
  scroll: number
}

const serializers = new Map<string, () => ExplorerViewState>()

/** A mounted ExplorerPane registers a getter for its live expanded-set + scroll. */
export function registerExplorerState(paneId: string, fn: () => ExplorerViewState): void { serializers.set(paneId, fn) }
export function unregisterExplorerState(paneId: string): void { serializers.delete(paneId) }

/** The pane's current view-state, or null if it has no live ExplorerPane (not mounted / not an explorer). */
export function readExplorerState(paneId: string): ExplorerViewState | null { return serializers.get(paneId)?.() ?? null }

const pending = new Map<string, ExplorerViewState>()

/** Stash an explorer's view-state just before its instance unmounts in a minimize/restore transition. */
export function stashExplorerState(paneId: string, state: ExplorerViewState): void { pending.set(paneId, state) }

/** Consume (once) the stashed view-state on the remounting instance, or null when there is none. */
export function consumeExplorerState(paneId: string): ExplorerViewState | null {
  const s = pending.get(paneId)
  pending.delete(paneId)
  return s ?? null
}
