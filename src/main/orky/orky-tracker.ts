import { join } from 'node:path'
import type { OrkyPaneStatus } from '@shared/types'
import { findOrkyRoot } from './find-orky-root'
import { OrkyRootEngine, type OrkyRootEngineOpts } from './orky-root-engine'

export type OrkyTrackerOpts = OrkyRootEngineOpts

/** Per-pane identity token. Claimed BEFORE the first `await` (session-identity race pattern) so a
 *  concurrent watch/unwatch supersedes cleanly. */
interface PaneSession { token: object }

/**
 * Pane-facing facade over the SHARED `OrkyRootEngine` (feature 0005, TASK-006 — extracted from 0004's
 * monolithic `OrkyTracker`). Resolves a pane's tracked cwd to a `.orky/` root (`findOrkyRoot`, unchanged)
 * and translates the engine's per-root `onStatus` fan-out into the existing pane-scoped `orky:status`
 * emit this class has always exposed to `register-orky.ts` — PUBLIC API and emitted payloads are
 * byte-identical to 0004 (no behavior change, a pure structural refactor).
 *
 * When constructed WITHOUT an injected `engine` (the common case in tests and any standalone use), this
 * tracker creates and OWNS a private `OrkyRootEngine` (using `opts`) and disposes it on `dispose()`. The
 * composition root instead constructs ONE shared `OrkyRootEngine` (also used by `OrkyRegistry`) and
 * injects it here, so a root watched by N panes + the persisted explicit list still has exactly ONE
 * chokidar watcher process-wide (REQ-014/REQ-020) — `dispose()` then only removes THIS tracker's own
 * pane consumers and leaves the shared engine's lifecycle to the composition root.
 *
 * `watch()` now ADDITIVELY resolves to the project root (or `null`) — previously effectively
 * `Promise<void>`; 0004's frozen tests never inspect the return value. This lets `register-orky.ts`
 * forward pane-root membership to the cross-project registry with no second `findOrkyRoot` walk.
 */
export class OrkyTracker {
  private sessions = new Map<string, PaneSession>()
  private paneOrkyDir = new Map<string, string>() // paneId -> orkyDir, for the fan-out below
  private readonly engine: OrkyRootEngine
  private readonly ownsEngine: boolean
  private readonly unsubscribe: () => void

  constructor(
    private readonly emit: (paneId: string, status: OrkyPaneStatus | null) => void,
    opts: OrkyTrackerOpts = {},
    engine?: OrkyRootEngine
  ) {
    this.engine = engine ?? new OrkyRootEngine(opts)
    this.ownsEngine = !engine
    this.unsubscribe = this.engine.onStatus((orkyDir, status) => {
      for (const [paneId, dir] of this.paneOrkyDir) {
        if (dir === orkyDir) this.emit(paneId, status)
      }
    })
  }

  /** Resolves to the PROJECT root (the dir containing `.orky/`), or `null` when there is no `.orky`
   *  ancestor (or the watch was superseded by a concurrent watch/unwatch for the same pane id). */
  async watch(id: string, cwd: string): Promise<string | null> {
    this.detach(id) // remove any prior watch for this id (silent — no emit)
    const sess: PaneSession = { token: {} }
    this.sessions.set(id, sess) // claim the slot BEFORE awaiting so a concurrent watch/unwatch can supersede
    // No maxDepth override: the default bound (DEFAULT_ORKY_ROOT_MAX_DEPTH, FINDING-DA-006) applies.
    // An explicit `{ maxDepth: 8 }` here once silently reinstated the old >8-deep chrome cliff at the
    // ONLY production call site — pinned by tests/main/find-orky-root-depth.test.ts.
    const root = await findOrkyRoot(cwd)
    if (this.sessions.get(id) !== sess) return null // superseded during discovery
    if (!root) { this.sessions.delete(id); this.emit(id, null); return null } // no .orky ancestor → cleared
    const orkyDir = join(root, '.orky')
    // Set the mapping BEFORE awaiting addConsumer so THIS pane also receives the imminent first read's
    // fan-out (the engine's onStatus subscriber above scans paneOrkyDir synchronously during that await).
    this.paneOrkyDir.set(id, orkyDir)
    await this.engine.addConsumer(`pane:${id}`, orkyDir)
    if (this.sessions.get(id) !== sess) { // superseded mid-add (a concurrent unwatch/re-watch won)
      if (this.paneOrkyDir.get(id) === orkyDir) this.paneOrkyDir.delete(id)
      return null
    }
    return root
  }

  unwatch(id: string): void {
    if (!this.sessions.has(id)) return // never watched (or already unwatched) → no spurious cleared emit
    this.detach(id)
    this.emit(id, null)
  }

  /** Removes this tracker's own pane consumers from the engine and unsubscribes. When this tracker
   *  OWNS a private engine (no engine was injected at construction), that engine is disposed too — a
   *  SHARED, injected engine's lifecycle belongs to the composition root, not any one facade. */
  dispose(): void {
    this.sessions.clear()
    for (const id of [...this.paneOrkyDir.keys()]) this.engine.removeConsumer(`pane:${id}`)
    this.paneOrkyDir.clear()
    this.unsubscribe()
    if (this.ownsEngine) this.engine.dispose()
  }

  /** Detach a pane from its session + the engine consumer it claimed (if any). Silent (no emit). */
  private detach(id: string): void {
    this.sessions.delete(id)
    const dir = this.paneOrkyDir.get(id)
    if (dir !== undefined) {
      this.paneOrkyDir.delete(id)
      this.engine.removeConsumer(`pane:${id}`)
    }
  }
}
