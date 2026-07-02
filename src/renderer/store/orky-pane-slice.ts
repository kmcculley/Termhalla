// Per-pane Orky DETAIL runtime for the native OrkyPane (feature 0009, TASK-010 —
// REQ-005/REQ-010/REQ-011/REQ-016/REQ-017/REQ-022). Pure and api-free: the preload bridge, the
// fold mode (derived ONCE by the composition root via caseFoldFromPlatform(navigator.platform))
// and updatePaneConfig are all INJECTED — the slice reads no ambient platform state, no clock, and
// runs no timer, so it is driven as plain objects under the node-env harness.
//
// Trigger discipline (REQ-010): fetches happen on T1 bind events (fetchOrkyDetail), T2 own-root
// change notifications while displayed (notifyOrkyRootChanged), and T3 hidden→displayed transitions
// with suppressed staleness (setOrkyPaneHidden) — nothing else. At most ONE in-flight fetch per
// pane; triggers arriving mid-flight coalesce into exactly ONE follow-up (latest root wins); a
// settling response is DISCARDED unless it matches the pane's current binding AND fetch generation
// (the issue-time guard — the F6 REQ-003 arbitration pattern; no IPC-ordering assumption is
// load-bearing). The fan-out is PER-ROOT TARGETED (REQ-016): a notification for another root
// touches nothing — zero fetches, zero state writes, reference-stable entries.
import type { OrkyRootDetailResult } from '@shared/types'
import { sameProjectRoot } from '@shared/orky-pane'

/** One pane's detail runtime. Pruned through the SAME clearPaneRuntime seam as every other
 *  per-pane map (CONV-011/REQ-017) — no entry outlives its pane. */
export interface OrkyPaneDetailEntry {
  root: string                          // the root the last fetch targeted ('' = unbound)
  detail: OrkyRootDetailResult | null   // null until the first settle
  error: string | null                  // a failed refresh's specific text; held detail keeps rendering
  inFlight: boolean
  pendingRefetch: boolean               // at most ONE coalesced follow-up (this IS the coalescing)
  stale: boolean                        // a rootChanged notification arrived while hidden (REQ-010 T3)
  hidden: boolean                       // EFFECTIVE visibility — BOTH keep-mounted hidden hosts drive it:
                                        // the minimized host AND the inactive-workspace host (FINDING-013)
}

export interface OrkyPaneSlice {
  fetchOrkyDetail: (paneId: string, root: string) => void
  notifyOrkyRootChanged: (root: string) => void
  setOrkyPaneHidden: (paneId: string, hidden: boolean) => void
  rebindOrkyPane: (wsId: string, paneId: string, root: string) => void
}

interface OrkyPaneSliceState {
  orkyPaneDetail: Record<string, OrkyPaneDetailEntry>
}

export interface OrkyPaneSliceDeps {
  set: (patch: Partial<OrkyPaneSliceState> | ((s: OrkyPaneSliceState) => Partial<OrkyPaneSliceState>)) => void
  get: () => OrkyPaneSliceState
  /** The preload bridge, injected (never `../api` — keeps the slice unit-testable). */
  registryDetail: (root: string) => Promise<OrkyRootDetailResult>
  /** Fold mode for binding equality — derived ONCE at composition, never read ambiently here. */
  caseFold: boolean
  updatePaneConfig: (wsId: string, paneId: string, patch: { root: string }) => void
}

const EMPTY_ENTRY: OrkyPaneDetailEntry = {
  root: '', detail: null, error: null, inFlight: false, pendingRefetch: false, stale: false, hidden: false
}

export function createOrkyPaneSlice(
  { set, get, registryDetail, caseFold, updatePaneConfig }: OrkyPaneSliceDeps
): OrkyPaneSlice {
  // Issue-time fetch generation per pane: a settling response whose generation is no longer the
  // pane's newest is fully discarded — the newer fetch owns the entry's lifecycle. Held in slice
  // scope (it drives no render) and self-cleaning: keys are only ever pane ids that fetched.
  const generations = new Map<string, number>()

  const patchEntry = (paneId: string, patch: Partial<OrkyPaneDetailEntry>): void => {
    set(s => ({
      orkyPaneDetail: {
        ...s.orkyPaneDetail,
        [paneId]: { ...(s.orkyPaneDetail[paneId] ?? EMPTY_ENTRY), ...patch }
      }
    }))
  }

  const settle = (
    paneId: string, issuedRoot: string, gen: number,
    result: OrkyRootDetailResult | null, error: string | null
  ): void => {
    const entry = get().orkyPaneDetail[paneId]
    if (!entry) return                            // pane closed/pruned mid-flight — nothing to apply
    if (generations.get(paneId) !== gen) return   // superseded by a newer fetch — it owns the entry
    const stillCurrent = entry.root !== '' && sameProjectRoot(entry.root, issuedRoot, { caseFold })
    if (!stillCurrent) {
      // Rebound mid-flight (latest root wins): the stale payload is never applied; the coalesced
      // follow-up below re-fetches the CURRENT binding.
      patchEntry(paneId, { inFlight: false })
    } else if (result !== null) {
      patchEntry(paneId, { detail: result, error: null, inFlight: false })
    } else {
      // A FAILED refresh keeps any stale-but-valid detail rendering — the specific error is
      // surfaced alongside it, never a blank (REQ-011 / CONV-001).
      patchEntry(paneId, { error, inFlight: false })
    }
    // The coalesced follow-up re-checks the displayed/bound gate at SETTLE time (REQ-010 /
    // FINDING-031): a pane hidden mid-flight converts the follow-up into the stale mark (the T3
    // restore fetch then covers it); an unbound one is dropped outright — a hidden or unbound pane
    // never fetches, not even via a follow-up queued while it was still displayed.
    const after = get().orkyPaneDetail[paneId]
    if (!after?.pendingRefetch) return
    if (after.root === '') patchEntry(paneId, { pendingRefetch: false })
    else if (after.hidden) patchEntry(paneId, { pendingRefetch: false, stale: true })
    else issue(paneId, after.root)
  }

  const issue = (paneId: string, root: string): void => {
    const gen = (generations.get(paneId) ?? 0) + 1
    generations.set(paneId, gen)
    patchEntry(paneId, { root, inFlight: true, pendingRefetch: false })
    registryDetail(root).then(
      result => settle(paneId, root, gen, result, null),
      err => settle(paneId, root, gen, null,
        `Orky detail refresh for ${root} failed: ${err instanceof Error ? err.message : String(err)}`)
    )
  }

  const fetchOrkyDetail = (paneId: string, root: string): void => {
    const entry = get().orkyPaneDetail[paneId]
    if (entry?.inFlight) {
      // Coalesce (REQ-010): never a second concurrent call — exactly ONE follow-up, latest root wins.
      if (!entry.pendingRefetch || entry.root !== root) patchEntry(paneId, { root, pendingRefetch: true })
      return
    }
    issue(paneId, root)
  }

  const notifyOrkyRootChanged = (root: string): void => {
    // PER-ROOT TARGETED fan-out (REQ-016/REQ-022): only panes whose binding sameProjectRoot-matches
    // the notified root react at all. An unbound ('') entry never fetches — not even for a ''
    // notification. Non-matching panes get zero fetches AND zero state writes (reference-stable).
    const all = get().orkyPaneDetail
    for (const paneId of Object.keys(all)) {
      const entry = all[paneId]
      if (entry.root === '' || root === '') continue
      if (!sameProjectRoot(entry.root, root, { caseFold })) continue
      if (entry.hidden) {
        // T3 suppression: a hidden pane fetches nothing; it marks itself stale for the restore.
        if (!entry.stale) patchEntry(paneId, { stale: true })
      } else {
        fetchOrkyDetail(paneId, entry.root)
      }
    }
  }

  const setOrkyPaneHidden = (paneId: string, hidden: boolean): void => {
    const entry = get().orkyPaneDetail[paneId]
    if (!entry || entry.hidden === hidden) return
    if (!hidden && entry.stale) {
      // T3: a hidden→displayed transition with suppressed staleness fetches exactly once.
      patchEntry(paneId, { hidden: false, stale: false })
      fetchOrkyDetail(paneId, entry.root)
      return
    }
    patchEntry(paneId, { hidden })
  }

  const rebindOrkyPane = (wsId: string, paneId: string, root: string): void => {
    // Persist the new binding VERBATIM through the existing updatePaneConfig/autosave path
    // (REQ-005/REQ-011), then fetch fresh — mid-flight this coalesces (latest root wins).
    updatePaneConfig(wsId, paneId, { root })
    // FINDING-029: the previous binding's held payload must never render as the NEW root's data.
    // Clear held detail/error at the slice, BEFORE the fresh fetch, unless the held payload
    // already matches the new binding — so even a FAILED post-re-bind fetch can only surface the
    // new root's error over loading, never resurrect the old root's rows under the new identity.
    const entry = get().orkyPaneDetail[paneId]
    if (entry) {
      const held = entry.detail
      const heldMatchesNewBinding = held !== null && held.ok &&
        root !== '' && sameProjectRoot(held.root, root, { caseFold })
      if (!heldMatchesNewBinding && (entry.detail !== null || entry.error !== null)) {
        patchEntry(paneId, { detail: null, error: null })
      }
    }
    fetchOrkyDetail(paneId, root)
  }

  return { fetchOrkyDetail, notifyOrkyRootChanged, setOrkyPaneHidden, rebindOrkyPane }
}
