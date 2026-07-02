import type { OrkyRegistrySnapshot } from '@shared/types'
import { buildDecisionQueue, decisionQueueCount, type DecisionQueueGroup } from '@shared/decision-queue'
import type { State, SliceDeps } from './types'

type RegistrySlice = Pick<State,
  'setQueueOpen' | 'setRegistrySnapshot' | 'applyRecoveryPull' | 'recoveryPullFailed' |
  'queueGroups' | 'queueCount'>

// Specific + actionable error texts (CONV-001) — never a bare "error". Shown only while no valid
// snapshot is held (REQ-013): stale-but-valid data always keeps rendering instead.
const MALFORMED_PAYLOAD_ERROR =
  'Orky registry sent a malformed (non-array) payload — cross-project tracking is unavailable until a valid snapshot arrives.'
const PULL_FAILED_ERROR =
  'Orky registry snapshot pull failed — cross-project tracking is unavailable until a status push arrives.'

/** Structural deep equality over the JSON-shaped registry snapshot (REQ-008's short-circuit key). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArr = Array.isArray(a), bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr && bArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/** The F6 decision-queue registry slice (REQ-001/003/007/008/011/013/017): the last VALID
 *  `registry:status` snapshot, the error text shown when none is held, the session-scoped drawer
 *  state (never persisted — no save is scheduled anywhere in this slice), and the memoized derived
 *  selectors the badge AND the list both read (one selector, one number).
 *
 *  `setRegistrySnapshot` is the ONE ingestion chokepoint for both the push and the recovery pull.
 *  The pull is arbitrated by a monotonic `snapshotGeneration` captured at ISSUE time (REQ-003 /
 *  FINDING-004): if ANY snapshot was applied after the pull was issued, the late-settling pull is
 *  discarded — first valid snapshot wins, then pushes are the sole source. The generation tracks
 *  ORDER of application, not value change, so a deep-equal push still bumps it while keeping the
 *  existing state reference (zero re-renders, REQ-008) — but ONLY until the one recovery pull has
 *  settled (FINDING-013): the generation's sole consumer is that pull's staleness guard, so once
 *  it can no longer land, a value-identical push is a PURE no-op (no state write at all — nothing
 *  notifies store subscribers on the steady-state push path).
 *
 *  Loading is DERIVED, never stored: `registrySnapshot === null && registryError === null`. */
export function createRegistrySlice({ set, get }: SliceDeps): RegistrySlice {
  // Memoized on snapshot REFERENCE identity: an unchanged store value re-derives nothing, and
  // buildDecisionQueue runs at most once per distinct snapshot reference (REQ-007/REQ-008).
  let memoSnapshot: OrkyRegistrySnapshot | null | undefined
  let memoGroups: DecisionQueueGroup[] = []
  let memoCount = 0
  // True once the single mount-time registryCurrent() pull has settled (applied, discarded, or
  // rejected) — from then on the generation is dead and deep-equal pushes stop bumping it.
  let pullSettled = false
  const derive = (snapshot: OrkyRegistrySnapshot | null): void => {
    if (snapshot === memoSnapshot) return
    memoSnapshot = snapshot
    memoGroups = buildDecisionQueue(snapshot)
    memoCount = decisionQueueCount(memoGroups)
  }

  const applySnapshot = (input: unknown): void => {
    if (!Array.isArray(input)) {
      // Malformed payload: never a throw. With a valid snapshot held, keep rendering it (no error);
      // with none, surface the specific error state (REQ-013).
      if (get().registrySnapshot === null) set({ registryError: MALFORMED_PAYLOAD_ERROR })
      return
    }
    const next = input as OrkyRegistrySnapshot
    const held = get().registrySnapshot
    if (held !== null && deepEqual(held, next)) {
      // Value-identical push (F5 emits a NEW array object every recompute): keep the EXISTING state
      // reference so no subscribed component re-renders. The application order is recorded only
      // while the recovery pull is still in flight (its staleness guard is the generation's ONLY
      // consumer); afterwards this is a pure no-op — no root-state replacement, no subscriber
      // notification, on the session-long steady-state push path (FINDING-013).
      if (!pullSettled) set(s => ({ snapshotGeneration: s.snapshotGeneration + 1 }))
      return
    }
    set(s => ({ registrySnapshot: next, registryError: null, snapshotGeneration: s.snapshotGeneration + 1 }))
  }

  return {
    // Session-scoped drawer state, mirroring setNotesOpen: no persistence side effect (REQ-017).
    setQueueOpen: (open) => set({ queueOpen: open }),

    setRegistrySnapshot: applySnapshot,

    applyRecoveryPull: (input, issuedAtGeneration) => {
      // Applied or discarded, the pull has SETTLED either way — the generation is dead from here.
      pullSettled = true
      // Discard a stale pull: anything applied since it was issued supersedes it (REQ-003).
      if (get().snapshotGeneration !== issuedAtGeneration) return
      applySnapshot(input)
    },

    recoveryPullFailed: () => {
      pullSettled = true
      // A rejection errors ONLY when no valid snapshot is held; held data is never disturbed and
      // the loading state never resurrects (REQ-011/REQ-013).
      if (get().registrySnapshot === null) set({ registryError: PULL_FAILED_ERROR })
    },

    queueGroups: () => {
      derive(get().registrySnapshot)
      return memoGroups
    },

    queueCount: () => {
      derive(get().registrySnapshot)
      return memoCount
    }
  }
}
