import type { FSWatcher } from 'chokidar'
import { readFile, readdir, stat, lstat } from 'node:fs/promises'
import { safeWatch } from '../safe-watcher'
import { basename, join } from 'node:path'
import type { OrkyPaneStatus, OrkyFeatureStatus, OrkyPhase } from '@shared/types'
import {
  normalizeFeatureRaw, normalizeFindings, orkyFeatureStatus, orkyPaneStatus, parseOrkyTimestamp,
  resolveStallThresholdMs
} from '@shared/orky-status'

/** Read-path resource bounds (REQ-015 / 0004's REQ-025 / FINDING-SEC-003) — STATED limits, each warned
 *  on (no silent capping). An adversarial `features/` tree with thousands of dirs, or a multi-hundred-MiB
 *  JSON file, cannot occupy the re-read coroutine for seconds or drive a GiB-class main-process
 *  allocation. Applied per-root, for EVERY tracked root (not only the first). */
const MAX_FEATURE_DIRS = 200
const MAX_FILE_BYTES = 1024 * 1024 // 1 MiB

/** Per-consumer identity token. Claimed BEFORE the first `await` (session-identity race pattern) so a
 *  concurrent addConsumer/removeConsumer supersedes cleanly. */
interface ConsumerSession { token: object; orkyDir: string }

/** One shared watcher + debounced re-read per resolved `.orky/` root (REQ-014). The computed status is
 *  fanned out to every `onStatus` subscriber (regardless of which consumer triggered the read), so N
 *  consumers (panes AND the registry's persisted entries) in one project share ONE chokidar watcher and
 *  ONE file-read per event rather than N× amplification. `gen` is the per-root re-read generation — a
 *  monotonically increasing token every `reread` claims before its first await and re-checks after
 *  every await, so an older, slower re-read overlapped by a newer one abandons instead of emitting
 *  stale status LAST (the same session-identity race pattern the consumer slots already use). */
interface Root {
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  orkyDir: string
  consumers: Set<string>
  gen: number
}

export interface OrkyRootEngineOpts {
  now?: () => number
  thresholdMs?: number
  debounceMs?: number
}

export type OrkyStatusListener = (orkyDir: string, status: OrkyPaneStatus | null) => void

/**
 * The SHARED per-root watch/read engine extracted from 0004's `OrkyTracker` (feature 0005, TASK-005).
 * Generalizes "consumer = a single pane" to "consumer = an opaque string id" (e.g. `pane:<id>` /
 * `persisted:<root>`, namespaced by the caller — the engine itself doesn't care about the namespace,
 * only about consumer-set cardinality per root), so a root watched by N panes AND the persisted explicit
 * list still gets exactly ONE chokidar watcher + ONE debounced re-read (REQ-014) shared across BOTH the
 * pane-chip path (`OrkyTracker`) and the cross-project registry (`OrkyRegistry`), constructed ONCE by the
 * composition root (REQ-020).
 *
 * Status delivery is a multi-subscriber `onStatus(cb): unsubscribe` pattern (mirroring the codebase's
 * pervasive `onXxx(cb) => () => void` convention) rather than a single constructor-bound callback, since
 * TWO independent consumers must each receive every emit for a root they care about.
 *
 * Structural clone of `UsageTracker`/0004's `OrkyTracker`: the session-identity race pattern (claim the
 * per-consumer slot BEFORE the first `await`, re-check after EVERY `await` so a concurrent
 * addConsumer/removeConsumer supersedes cleanly), a `.json`-basename event filter, `dispose()` that
 * closes every watcher + clears every timer (never keeps the Electron main process alive), and
 * warn-on-read-failure diagnostics (never silently swallowed, CONV-002). Strictly READ-ONLY (REQ-017):
 * only `fs/promises` reads, never a write, and never launching an external process/CLI.
 *
 * A root whose `orkyDir` does not exist on disk AT ALL (never created, or deleted after a persisted root
 * was added) surfaces `status: null` via `onStatus` — distinguishing "unreadable root" (REQ-018) from a
 * present-but-empty `.orky/` tree, which computes a valid, if empty, roll-up (REQ-006).
 */
export class OrkyRootEngine {
  private consumerSessions = new Map<string, ConsumerSession>()
  private roots = new Map<string, Root>()
  private listeners = new Set<OrkyStatusListener>()
  private readonly now: () => number
  /** Caller override only (the liveness `caller` source). When absent, each re-read resolves the
   *  threshold PER ROOT from `<orkyDir>/config.json` (`resolveStallThresholdMs`) so the stall verdict
   *  matches `liveness.stale` for that project — FINDING-PROV-002 close. */
  private readonly thresholdMs: number | undefined
  private readonly debounceMs: number

  constructor(opts: OrkyRootEngineOpts = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.thresholdMs = opts.thresholdMs
    this.debounceMs = opts.debounceMs ?? 300
  }

  /** Subscribe to every (orkyDir, status) emit across ALL roots. Returns an unsubscribe function. */
  onStatus(cb: OrkyStatusListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Idempotent: adding the same consumer to the same root twice is a no-op. Switching a consumer to a
   *  DIFFERENT root detaches it from the old one first (silent — no `onStatus` for the detach itself). */
  async addConsumer(consumerId: string, orkyDir: string): Promise<void> {
    const existing = this.consumerSessions.get(consumerId)
    if (existing) {
      if (existing.orkyDir === orkyDir) return // already tracking this exact root — no-op
      this.detach(consumerId) // switching roots: detach the old one first
    }
    const sess: ConsumerSession = { token: {}, orkyDir }
    this.consumerSessions.set(consumerId, sess) // claim BEFORE the first await (session-identity race pattern)

    let r = this.roots.get(orkyDir)
    if (!r) { r = { watcher: null, timer: null, orkyDir, consumers: new Set(), gen: 0 }; this.roots.set(orkyDir, r) }
    r.consumers.add(consumerId)

    await this.reread(orkyDir) // immediate read of the current on-disk state, fanned to all subscribers
    if (this.consumerSessions.get(consumerId) !== sess) return // superseded during discovery/the read
    const cur = this.roots.get(orkyDir)
    if (cur !== r || r.watcher) return // root torn down, or another consumer already opened the shared watcher

    const w = safeWatch(orkyDir, 'orky', {
      ignoreInitial: true,
      depth: 4, // covers active.json, config.json, features/<slug>/{state,findings}.json
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    // Filter to the target .json files BEFORE scheduling a re-read (REQ-014): routine edits to
    // non-target artifacts (01-concept.md, 02-spec.md, plan/test markdown) must NOT fire a roll-up.
    const onEvt = (p: string): void => { if (isTargetFile(p)) this.schedule(orkyDir) }
    w.on('add', onEvt).on('change', onEvt).on('unlink', onEvt)
    r.watcher = w
  }

  /** Silent no-op if `consumerId` is unknown. Tears the root's watcher/timer down when it was the LAST
   *  consumer (REQ-014/REQ-019). */
  removeConsumer(consumerId: string): void {
    this.detach(consumerId)
  }

  /** The current consumer ids registered against a resolved `orkyDir` (so a caller can derive
   *  membership/provenance without its own bookkeeping). */
  getConsumers(orkyDir: string): ReadonlySet<string> {
    return this.roots.get(orkyDir)?.consumers ?? new Set()
  }

  /** Closes EVERY watcher + clears EVERY timer across all roots (REQ-019) — never keeps the Electron
   *  main process alive. No further `onStatus` emits after this returns. */
  dispose(): void {
    this.consumerSessions.clear()
    for (const r of this.roots.values()) {
      if (r.timer) clearTimeout(r.timer)
      if (r.watcher) void r.watcher.close()
    }
    this.roots.clear()
  }

  /** Detach a consumer from its session + shared root, closing the root's watcher/timer when it was the
   *  last consumer on it. Silent (no `onStatus` emit). */
  private detach(consumerId: string): void {
    const sess = this.consumerSessions.get(consumerId)
    if (!sess) return
    this.consumerSessions.delete(consumerId)
    const r = this.roots.get(sess.orkyDir)
    if (!r) return
    r.consumers.delete(consumerId)
    if (r.consumers.size === 0) {
      if (r.timer) clearTimeout(r.timer)
      if (r.watcher) void r.watcher.close()
      this.roots.delete(sess.orkyDir)
    }
  }

  private schedule(orkyDir: string): void {
    const r = this.roots.get(orkyDir)
    if (!r) return
    if (r.timer) clearTimeout(r.timer)
    r.timer = setTimeout(() => { void this.reread(orkyDir) }, this.debounceMs)
    // Unref'd (mirrors StatusEngine's interval): a pending debounce never keeps the Electron main
    // process alive on its own.
    ;(r.timer as { unref?: () => void }).unref?.()
  }

  private emitStatus(orkyDir: string, status: OrkyPaneStatus | null): void {
    for (const cb of this.listeners) cb(orkyDir, status)
  }

  /** Read + parse active.json and every feature's state/findings for one root, map to a roll-up, and
   *  fan it out to every `onStatus` subscriber. Re-checks the root identity AND the re-read generation
   *  after every await so a superseding removeConsumer/dispose — or a NEWER overlapping re-read of the
   *  same root (the walk covers up to `MAX_FEATURE_DIRS` dirs, so an older read can resolve after a
   *  newer one) — wins cleanly, never emitting stale status last. A root whose `orkyDir` does not
   *  exist on disk at all surfaces `status: null` (REQ-018) instead of an empty-but-valid roll-up. */
  private async reread(orkyDir: string): Promise<void> {
    const r = this.roots.get(orkyDir)
    if (!r) return
    const gen = ++r.gen // claim the generation BEFORE the first await (session-identity race pattern)
    const now = this.now()

    let dirExists = false
    try { dirExists = (await stat(orkyDir)).isDirectory() } catch { dirExists = false }
    if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
    if (!dirExists) { this.emitStatus(orkyDir, null); return }

    const active = await this.readJson(join(orkyDir, 'active.json'), { warnOnFail: false, sizeCap: true })
    if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
    const config = await this.readJson(join(orkyDir, 'config.json'), { warnOnFail: false, sizeCap: true })
    if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
    const thresholdMs = this.thresholdMs ?? resolveStallThresholdMs(config)
    const activeSlug = activeFeatureSlug(active)
    const activePhase = activeFeaturePhase(active)
    const lastTickAt = activeLastTick(active)

    let slugs: string[] = []
    try { slugs = await readdir(join(orkyDir, 'features')) }
    catch { slugs = [] }
    if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
    if (slugs.length > MAX_FEATURE_DIRS) {
      console.warn(`[orky] features/ has ${slugs.length} entries; capping at ${MAX_FEATURE_DIRS} (REQ-015)`)
      slugs = slugs.slice(0, MAX_FEATURE_DIRS)
    }

    const features: OrkyFeatureStatus[] = []
    for (const slug of slugs) {
      const fdir = join(orkyDir, 'features', slug)
      // Symlink guard (REQ-015 / FINDING-SEC-004): a `features/<slug>` symlink could redirect a read
      // outside the project — skip any symlinked entry rather than following it.
      let isLink = false
      try { isLink = (await lstat(fdir)).isSymbolicLink() } catch { continue }
      if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
      if (isLink) { console.warn(`[orky] skipping symlinked feature dir: ${fdir} (REQ-015)`); continue }

      const rawState = await this.readJson(join(fdir, 'state.json'), { warnOnFail: true, sizeCap: true })
      if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
      if (rawState === undefined) continue // unreadable / malformed / oversized → skipped, others still report
      const rawFindings = await this.readJson(join(fdir, 'findings.json'), { warnOnFail: false, sizeCap: true })
      if (this.roots.get(orkyDir) !== r || r.gen !== gen) return

      const raw = normalizeFeatureRaw(rawState)
      const findings = normalizeFindings(rawFindings)
      const isActive = !!activeSlug && raw.feature === activeSlug
      features.push(orkyFeatureStatus(
        raw, findings, isActive,
        isActive ? activePhase : null,
        isActive ? lastTickAt : null,
        now, thresholdMs
      ))
    }
    if (this.roots.get(orkyDir) !== r || r.gen !== gen) return
    const status = orkyPaneStatus(features)
    this.emitStatus(orkyDir, status)
  }

  /** Read + JSON.parse a file. Returns `undefined` on any read/parse failure (an absent file is fine).
   *  When `sizeCap`, stat first and skip+warn a file above `MAX_FILE_BYTES` (REQ-015) without reading it.
   *  When `warnOnFail`, a malformed parse is logged (mirroring UsageTracker), never silently swallowed. */
  private async readJson(path: string, { warnOnFail, sizeCap }: { warnOnFail: boolean; sizeCap: boolean }): Promise<unknown> {
    if (sizeCap) {
      let size: number
      try { size = (await stat(path)).size }
      catch { return undefined } // absent file
      if (size > MAX_FILE_BYTES) {
        console.warn(`[orky] skipping oversized ${path} (${size} bytes > ${MAX_FILE_BYTES}) (REQ-015)`)
        return undefined
      }
    }
    let content: string
    try { content = await readFile(path, 'utf8') }
    catch { return undefined }
    try { return JSON.parse(content) }
    catch (e) {
      if (warnOnFail) console.warn('[orky] failed to parse', path, ':', (e as Error).message)
      return undefined
    }
  }
}

/** Is `p` one of the target files whose change warrants a roll-up re-read (REQ-014)?
 *  `config.json` is a target since the FINDING-PROV-002 close: `watchdog.idle_threshold_seconds`
 *  governs the per-root stall threshold, so editing it must re-derive the verdict. */
function isTargetFile(p: string): boolean {
  const b = basename(p)
  return b === 'active.json' || b === 'state.json' || b === 'findings.json' || b === 'config.json'
}

/** The active feature's slug = the basename of `active.json.feature` (a `.orky/features/<slug>` path). */
function activeFeatureSlug(active: unknown): string | null {
  if (typeof active !== 'object' || active === null) return null
  const feature = (active as { feature?: unknown }).feature
  if (typeof feature !== 'string') return null
  const parts = feature.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/** The active feature's LIVE phase (`active.json.phase`) — passed through to the mapper. */
function activeFeaturePhase(active: unknown): OrkyPhase | null {
  if (typeof active !== 'object' || active === null) return null
  const phase = (active as { phase?: unknown }).phase
  return typeof phase === 'string' ? (phase as OrkyPhase) : null
}

/** The active heartbeat in ms (from `active.json.lastTickAt` ISO), parsed timezone-safely. */
function activeLastTick(active: unknown): number | null {
  if (typeof active !== 'object' || active === null) return null
  return parseOrkyTimestamp((active as { lastTickAt?: unknown }).lastTickAt)
}
