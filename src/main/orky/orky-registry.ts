import { dirname, join, resolve } from 'node:path'
import type { OrkyPaneStatus, OrkyRegistrySnapshot, RegistryMutationResult } from '@shared/types'
import { mergeRegistryMembership, buildRegistrySnapshot } from '@shared/orky-registry'
import { OrkyRootEngine } from './orky-root-engine'
import { OrkyRegistryStore } from '../persistence/orky-registry-store'
import { validateRegistryRoot } from './validate-root'

type SnapshotListener = (snapshot: OrkyRegistrySnapshot) => void

/**
 * The cross-project aggregator (feature 0005, TASK-007) — generalizes 0004's single-root, pane-scoped
 * `OrkyTracker` to a SET of roots rolled up into one pane-independent aggregate (REQ-001). Membership is
 * the union of (a) currently-open-pane roots, fed by `trackPaneRoot` from the SAME pane watch/unwatch
 * events `OrkyTracker` already resolves (not a duplicate discovery path) and (b) the persisted explicit
 * list (REQ-002/D2), deduplicated by resolved project-root path (`@shared/orky-registry`'s pure
 * `mergeRegistryMembership`/`buildRegistrySnapshot` — REQ-006/REQ-007, never forked here).
 *
 * Shares the ONE app-wide `OrkyRootEngine` with `OrkyTracker` (REQ-014/REQ-020): both `trackPaneRoot`
 * (pane membership) and `addRoot`/`init` (persisted membership) register consumers as `pane:<paneId>` /
 * `persisted:<root>` on the SAME engine instance — a root tracked by both a pane and the persisted list
 * still gets exactly ONE chokidar watcher, because the engine's own `addConsumer` is idempotent per
 * (consumerId, orkyDir) and `pane:<paneId>` is the EXACT id `OrkyTracker` itself already uses for that
 * pane (intentional double-registration of the same logical consumer, safe because `removeConsumer` is a
 * silent no-op on an already-removed id).
 *
 * `addRoot`/`removeRoot` are serialized through a single internal async queue (the moral equivalent of
 * the session-identity race pattern for this class's own mutating calls): a concurrent add+remove for the
 * SAME root always resolves to one deterministic, internally-consistent final state — never a torn one
 * split between the persisted store and the emitted snapshot (REQ-019).
 */
export class OrkyRegistry {
  private paneRoots = new Map<string, string>()                  // paneId -> project root
  private persistedRoots: string[] = []                          // sorted, codepoint, normalized
  private statusByRoot = new Map<string, OrkyPaneStatus | null>()
  private snapshot: OrkyRegistrySnapshot = []
  private listeners = new Set<SnapshotListener>()
  private readonly unsubscribeEngine: () => void
  private mutationChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly engine: OrkyRootEngine, private readonly store: OrkyRegistryStore) {
    this.unsubscribeEngine = engine.onStatus((orkyDir, status) => {
      this.statusByRoot.set(dirname(orkyDir), status)
      this.recompute()
    })
  }

  /** Subscribe to every full-set snapshot emit. Returns an unsubscribe function. */
  onSnapshot(cb: SnapshotListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Load the persisted explicit list and begin tracking every entry (pane-independent — REQ-004),
   *  tolerating a root whose `.orky/` no longer exists on disk (the engine's own read-failure tolerance
   *  surfaces `status: null`; the root REMAINS a member because persistence, not pane-presence, is the
   *  membership rule for it — REQ-018). Computes + emits the initial snapshot. */
  async init(): Promise<void> {
    this.persistedRoots = await this.store.load()
    for (const root of this.persistedRoots) {
      await this.engine.addConsumer(`persisted:${root}`, join(root, '.orky'))
    }
    this.recompute()
  }

  /** Called by the pane-chip wiring on every pane root resolution/clear, across ALL windows
   *  (REQ-002/REQ-003). `root: null` (pane closed or its cwd left the `.orky/` project) removes the
   *  pane's membership; a pane-only root that loses its last pane consumer leaves the aggregate UNLESS
   *  it is also persisted, in which case `source` degrades `'both'` -> `'persisted'` rather than the
   *  entry disappearing. */
  trackPaneRoot(paneId: string, root: string | null): void {
    const prev = this.paneRoots.get(paneId)
    if (prev !== undefined) {
      this.paneRoots.delete(paneId)
      this.engine.removeConsumer(`pane:${paneId}`)
    }
    if (root !== null) {
      this.paneRoots.set(paneId, root)
      void this.engine.addConsumer(`pane:${paneId}`, join(root, '.orky'))
    }
    this.recompute()
  }

  /** Validates (TASK-003), then on success idempotently adds the normalized root to the persisted list,
   *  persists it, begins tracking it, and recomputes + emits. NEVER throws; on failure the list is left
   *  unchanged (REQ-009/REQ-016). */
  async addRoot(input: unknown): Promise<RegistryMutationResult> {
    return this.exclusive(async () => {
      const v = await validateRegistryRoot(input)
      if (!v.ok) return { ok: false, roots: [...this.persistedRoots], error: v.error }
      const root = v.root
      if (!this.persistedRoots.includes(root)) {
        this.persistedRoots = sortUnique([...this.persistedRoots, root])
        await this.store.save(this.persistedRoots)
        await this.engine.addConsumer(`persisted:${root}`, join(root, '.orky'))
        this.recompute()
      }
      return { ok: true, root, roots: [...this.persistedRoots] }
    })
  }

  /** Removes a normalized root from the persisted list (idempotent no-op, never a throw, on an absent
   *  root or non-string input — REQ-010). If a pane consumer still references the SAME root, it remains
   *  a member with `source:'pane'` (the engine itself still has that consumer; only the registry's
   *  bookkeeping of which source contributed changes). */
  async removeRoot(input: unknown): Promise<RegistryMutationResult> {
    return this.exclusive(async () => {
      if (typeof input !== 'string') return { ok: true, roots: [...this.persistedRoots] }
      let normalized: string
      try { normalized = resolve(input) } catch { return { ok: true, roots: [...this.persistedRoots] } }
      if (!this.persistedRoots.includes(normalized)) return { ok: true, roots: [...this.persistedRoots] }
      this.persistedRoots = this.persistedRoots.filter(r => r !== normalized)
      await this.store.save(this.persistedRoots)
      this.engine.removeConsumer(`persisted:${normalized}`)
      this.recompute()
      return { ok: true, roots: [...this.persistedRoots] }
    })
  }

  /** Pure read: the last computed snapshot. Never mutates, never emits (REQ-011). */
  current(): OrkyRegistrySnapshot { return this.snapshot }

  /** Pure read: the persisted explicit list ONLY (excludes ephemeral pane-only roots — REQ-012). */
  roots(): string[] { return [...this.persistedRoots] }

  /** Removes every `persisted:*` consumer THIS instance registered (pane consumers are owned by
   *  `OrkyTracker` instances and removed by THEM) and unsubscribes from the shared engine. Does NOT
   *  close the shared engine itself — its lifecycle belongs to the composition root. */
  dispose(): void {
    for (const root of this.persistedRoots) this.engine.removeConsumer(`persisted:${root}`)
    this.unsubscribeEngine()
    this.listeners.clear()
  }

  /** Serializes mutating calls (addRoot/removeRoot) through a single chain so a concurrent add+remove
   *  for the same root always resolves to one deterministic, internally-consistent final state (REQ-019)
   *  — the moral equivalent of the session-identity race pattern for this class's own async mutations. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(fn, fn)
    this.mutationChain = run.then(() => undefined, () => undefined)
    return run
  }

  /** The ONLY place membership + status are turned into the emitted shape (so REQ-007's determinism is
   *  inherited automatically) — recomputed + (re-)emitted on every membership OR status change, never a
   *  partial/delta payload (REQ-008). */
  private recompute(): void {
    const paneRootSet = new Set(this.paneRoots.values())
    const membership = mergeRegistryMembership(paneRootSet, this.persistedRoots)
    this.snapshot = buildRegistrySnapshot(membership, this.statusByRoot)
    for (const cb of this.listeners) cb(this.snapshot)
  }
}

function sortUnique(roots: string[]): string[] {
  return [...new Set(roots)].sort()
}
