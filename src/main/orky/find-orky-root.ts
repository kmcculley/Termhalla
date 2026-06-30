import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** From `cwd`, find the first directory (cwd or a BOUNDED number of ancestors) that contains a
 *  `.orky/` directory, or `null`. The walk is deterministic and capped — it never climbs to the
 *  filesystem root unbounded (risk #1). Resolves the spec's "a directory whose tree contains `.orky/`"
 *  (REQ-012) to an upward search keyed on the pane's tracked cwd (OSC 7 / OSC 9;9). */
export function findOrkyRoot(cwd: string, opts: { maxDepth?: number } = {}): string | null {
  const maxDepth = opts.maxDepth ?? 8
  let dir = cwd
  for (let i = 0; i <= maxDepth; i++) {
    try {
      if (statSync(join(dir, '.orky')).isDirectory()) return dir
    } catch { /* no .orky here; keep walking up */ }
    const parent = dirname(dir)
    if (parent === dir) break // reached the filesystem root
    dir = parent
  }
  return null
}
