/**
 * Per-pane last-known tile size, used to size the off-layout `MinimizedPaneHost` to the pane's
 * pre-minimize geometry instead of always the full workspace body (FINDING-DA-002).
 *
 * A mounted PaneTile continuously reports its content box here (ResizeObserver). When a pane is
 * minimized its tile unmounts, but the last reported size remains, so the off-layout host can mount
 * the pane's body at the SAME width/height it had in the tile. That keeps the xterm grid (cols/rows)
 * unchanged across the minimize→remount, so there is no PTY resize and thus no ConPTY repaint — a
 * repaint would emit erase-line bytes that can evict the prompt from the ANSI-stripped status tail
 * and wedge needs-input detection (the status-tail gotcha). Only width/height are stored: position
 * does not affect the xterm grid (the host is `visibility:hidden`, off-layout), so there is no need
 * to track offsets. A single-pane full-body tile is the degenerate case (host == body == inset:0).
 *
 * Renderer memory only; never persisted (no content/secrets — REQ-016 untouched).
 */
export interface TileSize { width: number; height: number }

const sizes = new Map<string, TileSize>()

export function setTileSize(paneId: string, size: TileSize): void {
  if (size.width > 0 && size.height > 0) sizes.set(paneId, size)
}

/** The pane's last-known tile size, or null if no tile has reported one (then fall back to inset:0). */
export function getTileSize(paneId: string): TileSize | null { return sizes.get(paneId) ?? null }

export function clearTileSize(paneId: string): void { sizes.delete(paneId) }
