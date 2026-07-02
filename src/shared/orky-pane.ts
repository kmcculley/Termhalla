// Pure pane↔binding equality for the native OrkyPane (feature 0009, TASK-002 — REQ-005).
//
// PURE and renderer-safe: no DOM, no Electron, no renderer api bridge, no node builtins, and no
// ambient platform read — the renderer main world is contextIsolated, so the usual global is NOT
// defined even though the vitest harness defines it (F6's FINDING-003 trap). The fold mode is
// always INJECTED (`opts.caseFold`), derived ONCE at the renderer caller's composition layer via
// `caseFoldFromPlatform` (`@shared/decision-queue` — reused, never redefined here).
import { matchPaneRoot } from './decision-queue'

/**
 * EQUALITY (never containment/prefix) between two project-root spellings: slash style and trailing
 * separators fold ALWAYS; case folds iff `opts.caseFold` — the same fold semantics
 * `normalizeProjectRoot` (main-side) and F6's `foldPath` use, expressed as strict equality.
 *
 * Implemented as MUTUAL containment through the shared `matchPaneRoot` fold logic (single
 * definition, REQ-015): `a` within `[b]` AND `b` within `[a]` holds exactly when the folded
 * anchor + segment lists are identical — so `C:\dev\Termhalla` never matches `C:\dev\TermhallaX`
 * (sibling extension) and never matches `C:\dev\Termhalla\src` (a child is not its ancestor).
 * Total (CONV-002): an empty/non-string side is equal to nothing, never a throw.
 */
export function sameProjectRoot(a: string, b: string, opts: { caseFold: boolean }): boolean {
  return matchPaneRoot(a, [b], opts) !== null && matchPaneRoot(b, [a], opts) !== null
}

/**
 * Format a CARRIED epoch-ms instant (e.g. `OrkyGateDetail.at`) for display — the sanctioned pure
 * formatter REQ-009 names: a pure function of its argument (UTC, tz-independent), never a renderer
 * clock read (the component itself is clock-banned — TEST-430/451). `''` for a non-finite input
 * (total, CONV-002).
 */
export function formatOrkyInstant(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return ''
  return new Date(epochMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}
