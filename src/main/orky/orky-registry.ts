import { dirname, join, resolve } from 'node:path'
import type { OrkyPaneStatus, OrkyRegistrySnapshot, OrkyRootDetailResult, RegistryMutationResult } from '@shared/types'
import { mergeRegistryMembership, buildRegistrySnapshot } from '@shared/orky-registry'
import { OrkyRootEngine } from './orky-root-engine'
import { OrkyRegistryStore } from '../persistence/orky-registry-store'
import { normalizeProjectRoot, validateRegistryRoot } from './validate-root'
import { assembleOrkyRootDetail } from './orky-root-detail'

type SnapshotListener = (snapshot: OrkyRegistrySnapshot) => void
type RootChangedListener = (root: string) => void

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
  private rootChangedListeners = new Set<RootChangedListener>()
  private readonly unsubscribeEngine: () => void
  private mutationChain: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly engine: OrkyRootEngine, private readonly store: OrkyRegistryStore) {
    this.unsubscribeEngine = engine.onStatus((orkyDir, status) => {
      const root = dirname(orkyDir)
      this.statusByRoot.set(root, status)
      this.recompute()
      // Per-root change notification (feature 0009, REQ-022): fired on EVERY completed engine
      // re-read — including the null-status emit for a vanished orkyDir — with the same
      // case-preserved project-root spelling the snapshot/statusByRoot key on. Deliberately NO
      // delta gating (decision #7): the aggregate is lossy along exactly the detail dimensions,
      // so value-identity of the roll-up says nothing about the detail data's currency.
      for (const cb of [...this.rootChangedListeners]) cb(root)
    })
  }

  /** Subscribe to every full-set snapshot emit. Returns an unsubscribe function. */
  onSnapshot(cb: SnapshotListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Subscribe to per-root completed-re-read notifications (feature 0009, REQ-022). Rides the ONE
   *  existing `engine.onStatus` subscription this instance already holds — registering here adds NO
   *  engine consumer. Returns an unsubscribe function. */
  onRootChanged(cb: RootChangedListener): () => void {
    this.rootChangedListeners.add(cb)
    return () => { this.rootChangedListeners.delete(cb) }
  }

  /** Load the persisted explicit list and begin tracking every entry (pane-independent — REQ-004),
   *  tolerating a root whose `.orky/` no longer exists on disk (the engine's own read-failure tolerance
   *  surfaces `status: null`; the root REMAINS a member because persistence, not pane-presence, is the
   *  membership rule for it — REQ-018). Computes + emits the initial snapshot.
   *
   *  Routed through `exclusive()` (FINDING-QUAL-002) — the SAME serialization queue `addRoot`/`removeRoot`
   *  use — so a concurrently-QUEUED `addRoot`/`removeRoot` racing an in-flight `init()` can never
   *  interleave with its read-modify-write of `this.persistedRoots` (the "last-write-wins data loss"
   *  half of the original finding — genuinely closed by this).
   *
   *  `dispose()` is deliberately NOT routed through `exclusive()` (it must stay synchronous and take
   *  immediate effect — TEST-129 calls it and asserts zero consumers with no `await`; queuing it behind
   *  `exclusive()` would defer the actual teardown and break that contract). Instead, `init()` clones the
   *  codebase's session-identity race pattern (CLAUDE.md "Session-identity race pattern" gotcha): claim
   *  intent before the first `await`, then re-check `this.disposed` after EVERY `await` before doing
   *  anything with a side effect, so a synchronous `dispose()` landing in any gap between awaits (the
   *  only points JS lets it run) is seen immediately and `init()` bails out registering no further
   *  consumers — closing the "orphaned watcher `dispose()` can never close" half of the original finding
   *  too (REQ-019's "after dispose(), the service holds zero open watchers"). */
  async init(): Promise<void> {
    return this.exclusive(async () => {
      if (this.disposed) return
      this.persistedRoots = await this.store.load()
      if (this.disposed) return
      for (const root of this.persistedRoots) {
        await this.engine.addConsumer(`persisted:${root}`, join(root, '.orky'))
        if (this.disposed) return
      }
      this.recompute()
    })
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
      const canonical = this.resolveCanonical(root)
      this.paneRoots.set(paneId, canonical)
      // .catch: fire-and-forget — an unexpected addConsumer rejection must never become an unhandled
      // rejection that kills the main process (Node 22 --unhandled-rejections=throw).
      void this.engine.addConsumer(`pane:${paneId}`, join(canonical, '.orky')).catch((err) => {
        console.warn('[orky-registry] addConsumer failed:', err instanceof Error ? err.message : String(err))
      })
    }
    // Prune the departed root's cached status AFTER the (possible) re-add above, so a pane merely
    // re-resolving the SAME root keeps its live status; a root that genuinely left both membership
    // sources drops its `statusByRoot` entry instead of leaking it for the session's lifetime.
    if (prev !== undefined) this.pruneStatus(prev)
    this.recompute()
  }

  /** Validates (TASK-003), then on success idempotently adds the normalized root to the persisted list,
   *  persists it, begins tracking it, and recomputes + emits. NEVER throws; on failure the list is left
   *  unchanged (REQ-009/REQ-016).
   *
   *  Persist-FIRST discipline: the next list is saved to the store BEFORE `this.persistedRoots` is
   *  touched, and a rejected save (disk full / EPERM) returns a structured `{ok:false}` result with
   *  memory unchanged — never a memory/disk divergence, and never a rejection propagated through
   *  register-registry.ts to the renderer (which would contradict the never-throws contract above). A
   *  later retry of the same root starts clean instead of no-op'ing on poisoned in-memory state. */
  async addRoot(input: unknown): Promise<RegistryMutationResult> {
    return this.exclusive(async () => {
      const v = await validateRegistryRoot(input)
      if (!v.ok) return { ok: false, roots: [...this.persistedRoots], error: v.error }
      const root = this.resolveCanonical(v.root)
      if (!this.persistedRoots.includes(root)) {
        const next = sortUnique([...this.persistedRoots, root])
        try { await this.store.save(next) }
        catch (e) {
          return { ok: false, roots: [...this.persistedRoots], error: `failed to persist the root list: ${(e as Error).message}` }
        }
        this.persistedRoots = next
        await this.engine.addConsumer(`persisted:${root}`, join(root, '.orky'))
        this.recompute()
      }
      return { ok: true, root, roots: [...this.persistedRoots] }
    })
  }

  /** Removes a normalized root from the persisted list (idempotent no-op, never a throw, on an absent
   *  root or non-string input — REQ-010). If a pane consumer still references the SAME root, it remains
   *  a member with `source:'pane'` (the engine itself still has that consumer; only the registry's
   *  bookkeeping of which source contributed changes).
   *
   *  Routed through `resolveCanonical` (FINDING-SEC-010) — the SAME case/slash-folding lookup
   *  `addRoot`/`trackPaneRoot` use — so a `removeRoot` call naming a case/slash-divergent but physically
   *  identical spelling of an already-tracked root still finds and removes it, instead of silently
   *  no-op'ing (`{ok:true}`, REQ-010's "MUST remove" otherwise unmet) while the root stays watched.
   *
   *  Persist-FIRST, same as `addRoot`: the shrunk list is saved BEFORE memory is touched; a rejected
   *  save returns `{ok:false}` with the root surviving in BOTH memory and store — never diverged. */
  async removeRoot(input: unknown): Promise<RegistryMutationResult> {
    return this.exclusive(async () => {
      if (typeof input !== 'string') return { ok: true, roots: [...this.persistedRoots] }
      let normalized: string
      try { normalized = this.resolveCanonical(resolve(input)) } catch { return { ok: true, roots: [...this.persistedRoots] } }
      if (!this.persistedRoots.includes(normalized)) return { ok: true, roots: [...this.persistedRoots] }
      const next = this.persistedRoots.filter(r => r !== normalized)
      try { await this.store.save(next) }
      catch (e) {
        return { ok: false, roots: [...this.persistedRoots], error: `failed to persist the root list: ${(e as Error).message}` }
      }
      this.persistedRoots = next
      this.engine.removeConsumer(`persisted:${normalized}`)
      this.pruneStatus(normalized)
      this.recompute()
      return { ok: true, roots: [...this.persistedRoots] }
    })
  }

  /** Read-only per-root detail (feature 0009, REQ-006/REQ-007/REQ-008): the full per-gate /
   *  findings / escalations payload for ONE current aggregate MEMBER root. Argument validation
   *  lives HERE (the addRoot/removeRoot precedent, never the registrar): a non-string or
   *  non-member input gets a structured `root-not-tracked` rejection NAMING the input (CONV-001)
   *  and performs no filesystem read — the channel can never be used to read arbitrary paths.
   *  Membership is matched by NORMALIZED key (case/slash-folded) against BOTH sources (pane and
   *  persisted), and the read runs against the TRACKED case-preserved spelling. Stateless and
   *  one-shot (no engine consumer, no watcher, no write); never throws or rejects (CONV-002). */
  async detail(root: unknown): Promise<OrkyRootDetailResult> {
    if (typeof root !== 'string') {
      return {
        ok: false,
        root: String(root),
        error: `registry detail refused: ${String(root)} is not a tracked project root ` +
          '(expected one of the aggregate member root strings; got a non-string value)',
        errorKind: 'root-not-tracked'
      }
    }
    const member = this.memberSpelling(root)
    if (member === null) {
      return {
        ok: false,
        root,
        error: `registry detail refused: ${root} is not a tracked project root — only current ` +
          'aggregate members (open-pane or persisted roots) can be read. Open a terminal in that ' +
          'project or add it to the tracked list first.',
        errorKind: 'root-not-tracked'
      }
    }
    return assembleOrkyRootDetail(member, { now: () => Date.now() })
  }

  /** Pure read: the last computed snapshot. Never mutates, never emits (REQ-011). */
  current(): OrkyRegistrySnapshot { return this.snapshot }

  /** Pure read: the persisted explicit list ONLY (excludes ephemeral pane-only roots — REQ-012). */
  roots(): string[] { return [...this.persistedRoots] }

  /** Removes every `persisted:*` consumer THIS instance registered (pane consumers are owned by
   *  `OrkyTracker` instances and removed by THEM) and unsubscribes from the shared engine. Does NOT
   *  close the shared engine itself — its lifecycle belongs to the composition root.
   *
   *  Sets `disposed` FIRST, synchronously, before any other work (FINDING-QUAL-002) — this is the flag
   *  `init()` re-checks after every `await`, so an `init()` suspended mid-flight when `dispose()` runs
   *  bails out immediately instead of registering further consumers on a registry that already considers
   *  itself torn down. Looping over `this.persistedRoots` here is safe even for a root `init()` hasn't
   *  reached yet — `OrkyRootEngine.removeConsumer` is a documented silent no-op for an unknown consumer
   *  id, never an error. */
  dispose(): void {
    this.disposed = true
    for (const root of this.persistedRoots) this.engine.removeConsumer(`persisted:${root}`)
    this.unsubscribeEngine()
    this.listeners.clear()
    this.rootChangedListeners.clear()
  }

  /** Resolve `root` to an ALREADY-TRACKED spelling that case-insensitively (win32) matches it, if one
   *  exists (in either paneRoots or persistedRoots) — so a case/slash-divergent spelling of an
   *  already-known project collapses onto the SAME canonical string instead of creating a second,
   *  un-collapsed membership entry (FINDING-DA-001/REQ-002).
   *
   *  If NO existing match, returns `resolve(root)` — NOT the raw, possibly-unresolved `root` verbatim
   *  (FINDING-DA-001 residual gap, caught on review: the pane side's `root` arrives from `findOrkyRoot`'s
   *  raw return, e.g. a forward-slash OSC-7 cwd form, and was previously stored un-resolved on this
   *  first-seen path). `resolve()` here is CASE-PRESERVED (only `normalizeProjectRoot`'s internal `key`
   *  comparison folds case) but IS slash-canonical — matching what `join(canonical, '.orky')` and the
   *  engine's own `dirname(orkyDir)` naturally produce, so `statusByRoot`'s key always agrees with the
   *  membership map's key regardless of which source (pane or persisted) is first to observe a root, and
   *  a pane-first root written into the persisted store via a later `addRoot` is stored REQ-006-normalized
   *  rather than carrying forward a stray forward-slash spelling. */
  private resolveCanonical(root: string): string {
    return this.findTrackedSpelling(root) ?? resolve(root)
  }

  /** The ONE membership-source scan (FINDING-018 — never duplicated): the ALREADY-TRACKED,
   *  case-preserved spelling matching `root` by normalized key across BOTH sources (pane and
   *  persisted), or `null` when no member matches. Both `resolveCanonical` (which falls back to
   *  `resolve(root)` for first-seen roots) and `memberSpelling` (which must refuse non-members)
   *  delegate here, so the matching semantics can never silently desync between the two.
   *  `normalizeProjectRoot` throws propagate to the caller (resolveCanonical parity). */
  private findTrackedSpelling(root: string): string | null {
    const key = normalizeProjectRoot(root)
    for (const existing of this.paneRoots.values()) {
      if (normalizeProjectRoot(existing) === key) return existing
    }
    for (const existing of this.persistedRoots) {
      if (normalizeProjectRoot(existing) === key) return existing
    }
    return null
  }

  /** The ALREADY-TRACKED, case-preserved spelling matching `root` by normalized key (either
   *  membership source), or `null` when `root` is not a current member (feature 0009, REQ-006 —
   *  `detail`'s membership gate; the same fold semantics `resolveCanonical` uses, but NEVER falling
   *  back to the raw input: a non-member must be refused, not read). */
  private memberSpelling(root: string): string | null {
    try { return this.findTrackedSpelling(root) } catch { return null }
  }

  /** Drop a root's cached engine status once it has left BOTH membership sources (no pane consumer AND
   *  not persisted). Without this, `statusByRoot` only ever grows — every engine emit `set`s an entry,
   *  nothing ever deleted — an unbounded leak over a long session of opening/closing projects. A root
   *  still held by the OTHER source keeps its status (a `removeRoot` while a pane is open must not
   *  blank the surviving `source:'pane'` entry). */
  private pruneStatus(root: string): void {
    if (this.persistedRoots.includes(root)) return
    for (const r of this.paneRoots.values()) if (r === root) return
    this.statusByRoot.delete(root)
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
