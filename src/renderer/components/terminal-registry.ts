/**
 * Per-pane terminal snapshot registry. Each mounted TerminalPane registers a function that
 * serializes its xterm buffer (screen + scrollback) to an ANSI string; the store reads it when
 * main asks a window to hand a workspace's terminals off to another window (tab tear-off / re-dock).
 * Kept out of the zustand store because xterm instances are imperative DOM, not serializable state.
 */
const serializers = new Map<string, () => string>()

export function registerSerializer(paneId: string, fn: () => string): void { serializers.set(paneId, fn) }
export function unregisterSerializer(paneId: string): void { serializers.delete(paneId) }

/** The pane's current snapshot, or '' if it has no live terminal (not yet mounted / not a terminal). */
export function readPaneSnapshot(paneId: string): string { return serializers.get(paneId)?.() ?? '' }
