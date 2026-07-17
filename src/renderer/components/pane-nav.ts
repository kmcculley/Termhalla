/** Directional pane focus (QoL batch 2026-07-17): pick the neighbor a mod+alt+arrow should land
 *  on. Pure geometry over tile rects — the dispatcher (App.tsx) measures the visible tiles and
 *  hands them in, so this stays unit-testable without a DOM. */

export interface PaneRect { id: string; left: number; top: number; width: number; height: number }

export type NavDir = 'left' | 'right' | 'up' | 'down'

/** The pane whose center lies in `dir` from `fromId`'s center, nearest by a score that weights
 *  the orthogonal offset double — so the straight neighbor beats a nearer diagonal one. Null when
 *  there is no pane in that direction (no wrap: an edge chord is a calm no-op). */
export function directionalPaneTarget(dir: NavDir, fromId: string, rects: PaneRect[]): string | null {
  const from = rects.find(r => r.id === fromId)
  if (!from) return null
  const cx = (r: PaneRect) => r.left + r.width / 2
  const cy = (r: PaneRect) => r.top + r.height / 2
  const fx = cx(from), fy = cy(from)
  let best: string | null = null
  let bestScore = Infinity
  for (const r of rects) {
    if (r.id === fromId) continue
    const dx = cx(r) - fx, dy = cy(r) - fy
    const primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    const ortho = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (primary <= 1) continue // not in that direction
    const score = primary + ortho * 2
    if (score < bestScore) { bestScore = score; best = r.id }
  }
  return best
}
