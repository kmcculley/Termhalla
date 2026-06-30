import chokidar, { type FSWatcher } from 'chokidar'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrkyPaneStatus, OrkyFeatureStatus } from '@shared/types'
import {
  normalizeFeatureRaw, normalizeFindings, orkyFeatureStatus, orkyPaneStatus, STALL_THRESHOLD_MS
} from '@shared/orky-status'
import { findOrkyRoot } from './find-orky-root'

interface Session {
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  root: string
  orkyDir: string
}

export interface OrkyTrackerOpts {
  now?: () => number
  thresholdMs?: number
  debounceMs?: number
}

/** Watches a project's `<root>/.orky/` tree (resolved by a bounded upward walk from the pane's tracked
 *  cwd) and emits a live, rolled-up Orky status, re-reading on every change (debounced, coalesced).
 *
 *  Structural clone of `UsageTracker`: ONE bounded debounced chokidar watch per pane (NOT a watcher
 *  per feature), the session-identity race pattern (claim the map slot BEFORE the first `await`, then
 *  re-check `sessions.get(id) === sess` after EVERY `await` so a concurrent watch/unwatch supersedes
 *  cleanly), `dispose()` that closes all watchers + clears all timers (so it never keeps the Electron
 *  main process alive), and warn-on-read-failure. Strictly READ-ONLY: it never writes/creates/moves/
 *  deletes anything under `.orky/`, and it reads on-disk JSON directly (no per-poll process launch). */
export class OrkyTracker {
  private sessions = new Map<string, Session>()
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
    this.stop(id) // remove any prior watch for this id (stop is silent — no emit)
    const root = findOrkyRoot(cwd, { maxDepth: 8 })
    if (!root) { this.emit(id, null); return } // cwd has no .orky ancestor → cleared, hold no watcher
    const sess: Session = { watcher: null, timer: null, root, orkyDir: join(root, '.orky') }
    this.sessions.set(id, sess) // claim the slot BEFORE awaiting so a concurrent watch/unwatch can supersede
    await this.reread(id, sess) // immediate read of the current on-disk state
    if (this.sessions.get(id) !== sess) return // superseded during the read
    const w = chokidar.watch(sess.orkyDir, {
      ignoreInitial: true,
      depth: 4, // covers active.json, features/<slug>/{state,findings}.json
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    const onEvt = (): void => this.schedule(id)
    w.on('add', onEvt).on('change', onEvt).on('unlink', onEvt)
    sess.watcher = w
  }

  unwatch(id: string): void {
    this.stop(id)
    this.emit(id, null)
  }

  dispose(): void { for (const id of [...this.sessions.keys()]) this.stop(id) }

  private stop(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    if (s.watcher) void s.watcher.close()
    this.sessions.delete(id)
  }

  private schedule(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => { void this.reread(id, s) }, this.debounceMs)
  }

  /** Read + parse active.json and every feature's state/findings, map to a roll-up, and emit it.
   *  Re-checks the session identity after every await so a superseding unwatch/dispose wins cleanly. */
  private async reread(id: string, sess: Session): Promise<void> {
    if (this.sessions.get(id) !== sess) return
    const now = this.now()

    const active = await this.readJson(join(sess.orkyDir, 'active.json'), false)
    if (this.sessions.get(id) !== sess) return
    const activeSlug = activeFeatureSlug(active)
    const lastTickAt = activeLastTick(active)

    let slugs: string[] = []
    try { slugs = await readdir(join(sess.orkyDir, 'features')) }
    catch { slugs = [] }
    if (this.sessions.get(id) !== sess) return

    const features: OrkyFeatureStatus[] = []
    for (const slug of slugs) {
      const fdir = join(sess.orkyDir, 'features', slug)
      const rawState = await this.readJson(join(fdir, 'state.json'), true)
      if (this.sessions.get(id) !== sess) return
      if (rawState === undefined) continue // unreadable/malformed feature → skipped (others still report)
      const rawFindings = await this.readJson(join(fdir, 'findings.json'), false)
      if (this.sessions.get(id) !== sess) return
      const raw = normalizeFeatureRaw(rawState)
      const findings = normalizeFindings(rawFindings)
      const isActive = !!activeSlug && raw.feature === activeSlug
      features.push(orkyFeatureStatus(raw, findings, isActive, isActive ? lastTickAt : null, now, this.thresholdMs))
    }
    if (this.sessions.get(id) !== sess) return
    this.emit(id, orkyPaneStatus(features))
  }

  /** Read + JSON.parse a file. Returns `undefined` on any read/parse failure. When `warnOnFail`, a
   *  malformed read is logged (mirroring UsageTracker) rather than silently swallowed (REQ-019). */
  private async readJson(path: string, warnOnFail: boolean): Promise<unknown> {
    let content: string
    try { content = await readFile(path, 'utf8') }
    catch { return undefined } // an absent file (e.g. no active.json / no findings.json) is fine
    try { return JSON.parse(content) }
    catch (e) {
      if (warnOnFail) console.warn('[orky] failed to parse', path, ':', (e as Error).message)
      return undefined
    }
  }
}

/** The active feature's slug = the basename of `active.json.feature` (a `.orky/features/<slug>` path). */
function activeFeatureSlug(active: unknown): string | null {
  if (typeof active !== 'object' || active === null) return null
  const feature = (active as { feature?: unknown }).feature
  if (typeof feature !== 'string') return null
  const parts = feature.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/** The active heartbeat in ms (from `active.json.lastTickAt` ISO), or null when absent/unparseable. */
function activeLastTick(active: unknown): number | null {
  if (typeof active !== 'object' || active === null) return null
  const tick = (active as { lastTickAt?: unknown }).lastTickAt
  if (typeof tick !== 'string') return null
  const t = Date.parse(tick)
  return Number.isNaN(t) ? null : t
}
