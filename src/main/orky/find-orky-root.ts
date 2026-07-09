import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The default ancestor-walk bound. 8 was a real user-facing cliff (FINDING-DA-006, fixed
 *  2026-07-09): a pane >8 dirs below the project root — unremarkable in a monorepo — showed NO
 *  Orky chrome at all, purely as a function of cwd depth. 32 exceeds any real tree while keeping
 *  the walk finite and its worst-case cost bounded (each level is one statSync; the walk also
 *  stops at the filesystem root regardless). */
export const DEFAULT_ORKY_ROOT_MAX_DEPTH = 32

/** From `cwd`, find the first directory (cwd or a BOUNDED number of ancestors) that contains a
 *  `.orky/` directory, or `null`. The walk is deterministic and capped — it never climbs to the
 *  filesystem root unbounded (risk #1). Resolves the spec's "a directory whose tree contains `.orky/`"
 *  (REQ-012) to an upward search keyed on the pane's tracked cwd (OSC 7 / OSC 9;9).
 *
 *  Non-string-safe (REQ-024 / FINDING-SEC-001): runtime IPC args arrive as `unknown` (TS annotations are
 *  compile-time only), so a non-string `cwd` MUST degrade to `null` rather than throw a `TypeError` —
 *  which `void orky.watch(...)` would otherwise surface as an unhandled rejection that kills the main
 *  process (Node 22 `--unhandled-rejections=throw`). */
export function findOrkyRoot(cwd: string, opts: { maxDepth?: number } = {}): string | null {
  if (typeof cwd !== 'string') return null
  const maxDepth = opts.maxDepth ?? DEFAULT_ORKY_ROOT_MAX_DEPTH
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
