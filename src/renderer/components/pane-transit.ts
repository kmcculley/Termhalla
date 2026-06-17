/** Pane ids currently being moved between workspaces. An editor pane consults this on unmount so a
 *  move (which unmounts then remounts the pane) flushes its unsaved-edit draft instead of deleting
 *  it. Terminals don't need this — their scrollback rides the snapshot stash in terminal-registry. */
const moving = new Set<string>()
export function beginPaneTransit(paneId: string): void { moving.add(paneId) }
export function endPaneTransit(paneId: string): void { moving.delete(paneId) }
export function isPaneInTransit(paneId: string): boolean { return moving.has(paneId) }
