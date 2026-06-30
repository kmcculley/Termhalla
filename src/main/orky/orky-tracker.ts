import chokidar, { type FSWatcher } from 'chokidar'
import { readFile, readdir, stat, lstat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { OrkyPaneStatus, OrkyFeatureStatus, OrkyPhase } from '@shared/types'
import {
  normalizeFeatureRaw, normalizeFindings, orkyFeatureStatus, orkyPaneStatus, parseOrkyTimestamp,
  STALL_THRESHOLD_MS
} from '@shared/orky-status'
import { findOrkyRoot } from './find-orky-root'

/** Read-path resource bounds (REQ-025 / FINDING-SEC-003) — STATED limits, each warned on (no silent
 *  capping). An adversarial `features/` tree with thousands of dirs, or a multi-hundred-MiB JSON file,
 *  cannot occupy the re-read coroutine for seconds or drive a GiB-class main-process allocation. */
const MAX_FEATURE_DIRS = 200
const MAX_FILE_BYTES = 1024 * 1024 // 1 MiB

/** Per-pane identity token. Claimed BEFORE the first `await` (session-identity race pattern) so a
 *  concurrent watch/unwatch supersedes cleanly. `root` is the resolved `.orky/` key once known. */
interface PaneSession { token: object; root: string | null }

/** One shared watcher + debounced re-read per resolved `.orky/` root (REQ-027 / FINDING-PERF-002).
 *  The computed status is fanned out to every paneId bound to this root, so P panes in one project share
 *  ONE chokidar watcher and ONE file-read per event rather than P× amplification. */
interface Root {
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  orkyDir: string
  panes: Set<string>
}

export interface OrkyTrackerOpts {
  now?: () => number
  thresholdMs?: number
  debounceMs?: number
}

/** Watches a project's `<root>/.orky/` tree (resolved by a bounded upward walk from the pane's tracked
 *  cwd) and emits a live, rolled-up Orky status, re-reading on every change (debounced, coalesced).
 *
 *  Structural clone of `UsageTracker`: the session-identity race pattern (claim the per-pane slot BEFORE
 *  the first `await`, then re-check after EVERY `await` so a concurrent watch/unwatch supersedes cleanly),
 *  `unwatch` early-return for an unknown pane, a `.json` event filter, `dispose()` that closes all
 *  watchers + clears all timers (so it never keeps the Electron main process alive), and
 *  warn-on-read-failure. Strictly READ-ONLY: it never writes/creates/moves/deletes anything under
 *  `.orky/`, reads on-disk JSON directly (no per-poll process launch), and shares ONE watcher/read per
 *  resolved root (REQ-027). The active feature's `active.json.phase` is passed through as the LIVE phase
 *  (REQ-023); all timestamps are parsed timezone-safely (REQ-028). */
export class OrkyTracker {
  private sessions = new Map<string, PaneSession>()
  private roots = new Map<string, Root>()
  private readonly now: () => number
  private readonly thresholdMs: number
  private readonly debounceMs: number

  constructor(
    private readonly emit: (paneId: string, status: OrkyPaneStatus | null) => void,
    opts: OrkyTrackerOpts = {}
  ) {
    this.now = opts.now ?? (() => Date.now())
    this.thresholdMs = opts.thresholdMs ?? STALL_THRESHOLD_MS
    this.debounceMs = opts.debounceMs ?? 300
  }

  async watch(id: string, cwd: string): Promise<void> {
    this.detach(id) // remove any prior watch for this id (silent — no emit)
    const sess: PaneSession = { token: {}, root: null }
    this.sessions.set(id, sess) // claim the slot BEFORE awaiting so a concurrent watch/unwatch can supersede
    const root = await findOrkyRoot(cwd, { maxDepth: 8 })
    if (this.sessions.get(id) !== sess) return // superseded during discovery
    if (!root) { this.sessions.delete(id); this.emit(id, null); return } // no .orky ancestor → cleared, no watcher
    const orkyDir = join(root, '.orky')
    sess.root = orkyDir

    let r = this.roots.get(orkyDir)
    if (!r) { r = { watcher: null, timer: null, orkyDir, panes: new Set() }; this.roots.set(orkyDir, r) }
    r.panes.add(id)

    await this.reread(orkyDir) // immediate read of the current on-disk state, fanned to all panes
    if (this.sessions.get(id) !== sess) return // superseded during the read
    const cur = this.roots.get(orkyDir)
    if (cur !== r || r.watcher) return // root torn down, or another pane already opened the shared watcher

    const w = chokidar.watch(orkyDir, {
      ignoreInitial: true,
      depth: 4, // covers active.json, features/<slug>/{state,findings}.json
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    // Filter to the target .json files BEFORE scheduling a re-read (REQ-027 / FINDING-PERF-001): routine
    // edits to non-target artifacts (01-concept.md, 02-spec.md, plan/test markdown) must NOT fire a roll-up.
    const onEvt = (p: string): void => { if (isTargetFile(p)) this.schedule(orkyDir) }
    w.on('add', onEvt).on('change', onEvt).on('unlink', onEvt)
    r.watcher = w
  }

  unwatch(id: string): void {
    if (!this.sessions.has(id)) return // never watched (or already unwatched) → no spurious cleared emit
    this.detach(id)
    this.emit(id, null)
  }

  dispose(): void {
    this.sessions.clear()
    for (const r of this.roots.values()) {
      if (r.timer) clearTimeout(r.timer)
      if (r.watcher) void r.watcher.close()
    }
    this.roots.clear()
  }

  /** Detach a pane from its session + shared root, closing the root's watcher/timer when it was the last
   *  pane on it. Silent (no emit). */
  private detach(id: string): void {
    const sess = this.sessions.get(id)
    if (!sess) return
    this.sessions.delete(id)
    if (!sess.root) return
    const r = this.roots.get(sess.root)
    if (!r) return
    r.panes.delete(id)
    if (r.panes.size === 0) {
      if (r.timer) clearTimeout(r.timer)
      if (r.watcher) void r.watcher.close()
      this.roots.delete(sess.root)
    }
  }

  private schedule(orkyDir: string): void {
    const r = this.roots.get(orkyDir)
    if (!r) return
    if (r.timer) clearTimeout(r.timer)
    r.timer = setTimeout(() => { void this.reread(orkyDir) }, this.debounceMs)
  }

  /** Read + parse active.json and every feature's state/findings for one root, map to a roll-up, and emit
   *  it to every pane bound to the root. Re-checks the root identity after every await so a superseding
   *  unwatch/dispose wins cleanly. */
  private async reread(orkyDir: string): Promise<void> {
    const r = this.roots.get(orkyDir)
    if (!r) return
    const now = this.now()

    const active = await this.readJson(join(orkyDir, 'active.json'), { warnOnFail: false, sizeCap: true })
    if (this.roots.get(orkyDir) !== r) return
    const activeSlug = activeFeatureSlug(active)
    const activePhase = activeFeaturePhase(active)
    const lastTickAt = activeLastTick(active)

    let slugs: string[] = []
    try { slugs = await readdir(join(orkyDir, 'features')) }
    catch { slugs = [] }
    if (this.roots.get(orkyDir) !== r) return
    if (slugs.length > MAX_FEATURE_DIRS) {
      console.warn(`[orky] features/ has ${slugs.length} entries; capping at ${MAX_FEATURE_DIRS} (REQ-025)`)
      slugs = slugs.slice(0, MAX_FEATURE_DIRS)
    }

    const features: OrkyFeatureStatus[] = []
    for (const slug of slugs) {
      const fdir = join(orkyDir, 'features', slug)
      // Symlink guard (REQ-025c / FINDING-SEC-004): a `features/<slug>` symlink could redirect a read
      // outside the project — skip any symlinked entry rather than following it.
      let isLink = false
      try { isLink = (await lstat(fdir)).isSymbolicLink() } catch { continue }
      if (this.roots.get(orkyDir) !== r) return
      if (isLink) { console.warn(`[orky] skipping symlinked feature dir: ${fdir} (REQ-025)`); continue }

      const rawState = await this.readJson(join(fdir, 'state.json'), { warnOnFail: true, sizeCap: true })
      if (this.roots.get(orkyDir) !== r) return
      if (rawState === undefined) continue // unreadable / malformed / oversized → skipped, others still report
      const rawFindings = await this.readJson(join(fdir, 'findings.json'), { warnOnFail: false, sizeCap: true })
      if (this.roots.get(orkyDir) !== r) return

      const raw = normalizeFeatureRaw(rawState)
      const findings = normalizeFindings(rawFindings)
      const isActive = !!activeSlug && raw.feature === activeSlug
      features.push(orkyFeatureStatus(
        raw, findings, isActive,
        isActive ? activePhase : null,
        isActive ? lastTickAt : null,
        now, this.thresholdMs
      ))
    }
    if (this.roots.get(orkyDir) !== r) return
    const status = orkyPaneStatus(features)
    for (const id of r.panes) this.emit(id, status)
  }

  /** Read + JSON.parse a file. Returns `undefined` on any read/parse failure (an absent file is fine).
   *  When `sizeCap`, stat first and skip+warn a file above `MAX_FILE_BYTES` (REQ-025b) without reading it.
   *  When `warnOnFail`, a malformed parse is logged (mirroring UsageTracker), never silently swallowed. */
  private async readJson(path: string, { warnOnFail, sizeCap }: { warnOnFail: boolean; sizeCap: boolean }): Promise<unknown> {
    if (sizeCap) {
      let size: number
      try { size = (await stat(path)).size }
      catch { return undefined } // absent file
      if (size > MAX_FILE_BYTES) {
        console.warn(`[orky] skipping oversized ${path} (${size} bytes > ${MAX_FILE_BYTES}) (REQ-025)`)
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

/** Is `p` one of the three target files whose change warrants a roll-up re-read (REQ-027)? */
function isTargetFile(p: string): boolean {
  const b = basename(p)
  return b === 'active.json' || b === 'state.json' || b === 'findings.json'
}

/** The active feature's slug = the basename of `active.json.feature` (a `.orky/features/<slug>` path). */
function activeFeatureSlug(active: unknown): string | null {
  if (typeof active !== 'object' || active === null) return null
  const feature = (active as { feature?: unknown }).feature
  if (typeof feature !== 'string') return null
  const parts = feature.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/** The active feature's LIVE phase (`active.json.phase`) — passed through to the mapper (REQ-023). */
function activeFeaturePhase(active: unknown): OrkyPhase | null {
  if (typeof active !== 'object' || active === null) return null
  const phase = (active as { phase?: unknown }).phase
  return typeof phase === 'string' ? (phase as OrkyPhase) : null
}

/** The active heartbeat in ms (from `active.json.lastTickAt` ISO), parsed timezone-safely (REQ-028). */
function activeLastTick(active: unknown): number | null {
  if (typeof active !== 'object' || active === null) return null
  return parseOrkyTimestamp((active as { lastTickAt?: unknown }).lastTickAt)
}
