// Pure, Electron-free, fs/clock/IPC-free membership-merge + deterministic-sort logic behind the
// cross-project Orky registry aggregate (feature 0005, TASK-002). Generalizes 0004's single-root
// `OrkyTracker` roll-up (D3 — reuses `OrkyPaneStatus` verbatim, never forks it) to a SET of roots: the
// union of currently-open-pane roots (ephemeral, D2) and the persisted explicit list (manual, D2),
// keyed and deduplicated by resolved project-root absolute path (REQ-002).
//
// Total over malformed/empty input; no `Date.now`, no randomness, no I/O — straightforward to unit test
// exhaustively in isolation from the engine/registry service. Sort is the DEFAULT string comparator
// (codepoint order), NEVER `localeCompare` — so a re-read that doesn't change membership/status produces
// a byte-identical snapshot array regardless of insertion order (REQ-007).
import type { OrkyPaneStatus, OrkyRegistryEntry, OrkyRegistrySnapshot, OrkyRootSource } from './types'

/** Union of pane-resolved roots ∪ persisted roots, deduplicated by resolved root key (REQ-002). A root
 *  present in BOTH sources maps to `'both'`; pane-only → `'pane'`; persisted-only → `'persisted'`. The
 *  persisted array MAY contain a duplicate (e.g. a not-yet-normalized read) — this function is
 *  defensive on its own and never produces two map entries for one key. */
export function mergeRegistryMembership(
  paneRoots: ReadonlySet<string>,
  persistedRoots: readonly string[]
): Map<string, OrkyRootSource> {
  const membership = new Map<string, OrkyRootSource>()
  for (const root of paneRoots) membership.set(root, 'pane')
  for (const root of persistedRoots) {
    // A root repeated WITHIN persistedRoots itself must stay 'persisted' — 'both' only applies when the
    // root ALSO came from paneRoots (a prior 'persisted'/'both' entry from this same loop must not flip).
    const existing = membership.get(root)
    membership.set(root, existing === 'pane' || existing === 'both' ? 'both' : 'persisted')
  }
  return membership
}

/** One entry per membership key — `{ root, source, status }`, `status` from `statusByRoot` or `null`
 *  when absent/not-yet-read (REQ-006/REQ-018) — sorted by `root` using the DEFAULT (codepoint)
 *  comparator, explicitly NOT `localeCompare` (REQ-007). The same membership + status set always
 *  serializes identically regardless of Map/insertion order. */
export function buildRegistrySnapshot(
  membership: ReadonlyMap<string, OrkyRootSource>,
  statusByRoot: ReadonlyMap<string, OrkyPaneStatus | null>
): OrkyRegistrySnapshot {
  const entries: OrkyRegistryEntry[] = [...membership.entries()].map(([root, source]) => ({
    root,
    source,
    status: statusByRoot.get(root) ?? null
  }))
  // Codepoint comparison via `<`/`>` (NOT localeCompare, which collates by locale/ICU and would invert
  // e.g. 'Banana' vs. 'apple' in most locales).
  entries.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
  return entries
}
