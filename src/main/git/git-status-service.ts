import path from 'node:path'
import type { GitStatus } from '@shared/types'
import { safeWatch } from '../safe-watcher'
import { resolveGitRoot as defaultResolveRoot, runGitStatus as defaultRunStatus } from './probe'
import { parseStatus } from './parse-status'
import { startUnrefedTimeout, type ManagedTimer } from '../managed-interval'

export type Watcher = { close(): void | Promise<void> }
export type WatchFactory = (root: string, onChange: () => void) => Watcher

/** Real chokidar watch of a repo's .git dir, ignoring the noisy objects/ and logs/ subtrees. Catches
 *  HEAD/index/refs/MERGE_HEAD/FETCH_HEAD writes (commits, staging, checkout, fetch). Unstaged
 *  working-tree edits don't touch .git — those are covered by the command-done re-probe. */
function defaultWatchFactory(root: string, onChange: () => void): Watcher {
  const gitDir = path.join(root, '.git')
  const w = safeWatch(gitDir, 'git', {
    ignoreInitial: true,
    ignored: (p: string) => /[\\/](?:objects|logs)[\\/]/.test(p),
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
  })
  for (const ev of ['add', 'unlink', 'change', 'addDir', 'unlinkDir'] as const) {
    w.on(ev, (() => onChange()) as never)
  }
  return { close: () => w.close() }
}

interface PaneEntry { cwd: string; root: string | null; sig: string }
interface RootEntry { refs: Set<string>; watcher: Watcher; timer: ManagedTimer | null }

function sigOf(s: GitStatus | null): string {
  if (!s) return 'null'
  return `${s.root}|${s.branch}|${s.detached}|${s.upstream ?? ''}|${s.ahead}|${s.behind}|${s.staged}|${s.unstaged}|${s.untracked}`
}

/** Per-pane git status driven by cwd changes + a targeted .git watch + command-done re-probe.
 *  Mirrors CloudStatusService: shared AbortController re-armed on stop(), one in-flight probe per
 *  root (coalesced), signature dedup before pushing. Watches are ref-counted by repo root so panes
 *  sharing a repo share one watch + one probe. */
export class GitStatusService {
  private panes = new Map<string, PaneEntry>()
  private roots = new Map<string, RootEntry>()
  private probing = new Set<string>()
  private abort = new AbortController()

  constructor(
    private readonly onStatus: (paneId: string, status: GitStatus | null) => void,
    private readonly resolveRoot: (cwd: string, signal?: AbortSignal) => Promise<string | null> = defaultResolveRoot,
    private readonly runStatus: (root: string, signal?: AbortSignal) => Promise<string | null> = defaultRunStatus,
    private readonly makeWatcher: WatchFactory = defaultWatchFactory,
    private readonly debounceMs = 150
  ) {}

  async setCwd(paneId: string, cwd: string): Promise<void> {
    const prev = this.panes.get(paneId)
    if (prev?.cwd === cwd) return
    // Claim the slot synchronously so a concurrent setCwd can be detected after the await.
    this.panes.set(paneId, { cwd, root: prev?.root ?? null, sig: prev?.sig ?? '' })
    const root = await this.resolveRoot(cwd, this.abort.signal)
    const cur = this.panes.get(paneId)
    if (!cur || cur.cwd !== cwd) return   // superseded by a newer setCwd / removed
    if (prev?.root && prev.root !== root) this.unref(prev.root, paneId)
    cur.root = root
    if (!root) { this.push(paneId, null); return }
    this.ref(root, paneId)
    await this.probeRoot(root)
  }

  onCommandDone(paneId: string): void {
    const root = this.panes.get(paneId)?.root
    if (root) this.scheduleProbe(root)
  }

  removePane(paneId: string): void {
    const p = this.panes.get(paneId)
    if (!p) return
    if (p.root) this.unref(p.root, paneId)
    this.panes.delete(paneId)
  }

  stop(): void {
    this.abort.abort()
    this.abort = new AbortController()
    for (const r of this.roots.values()) { r.timer?.stop(); void r.watcher.close() }
    this.roots.clear()
    this.panes.clear()
    this.probing.clear()
  }

  private ref(root: string, paneId: string): void {
    let r = this.roots.get(root)
    if (!r) {
      r = { refs: new Set(), watcher: this.makeWatcher(root, () => this.scheduleProbe(root)), timer: null }
      this.roots.set(root, r)
    }
    r.refs.add(paneId)
  }

  private unref(root: string, paneId: string): void {
    const r = this.roots.get(root)
    if (!r) return
    r.refs.delete(paneId)
    if (r.refs.size === 0) {
      r.timer?.stop()
      void r.watcher.close()
      this.roots.delete(root)
    }
  }

  private scheduleProbe(root: string): void {
    const r = this.roots.get(root)
    if (!r) return
    r.timer?.stop()
    r.timer = startUnrefedTimeout(() => { r.timer = null; void this.probeRoot(root) }, this.debounceMs)
  }

  // One in-flight probe per root; a burst of watch events + a command-done collapse into at most one
  // git call (the trailing debounce schedules the next). Matches CloudStatusService's refresh guard.
  private async probeRoot(root: string): Promise<void> {
    if (this.probing.has(root)) return
    this.probing.add(root)
    try {
      const out = await this.runStatus(root, this.abort.signal)
      const r = this.roots.get(root)
      if (!r) return   // root released while probing
      const status: GitStatus | null = out == null ? null : { root, ...parseStatus(out) }
      for (const paneId of r.refs) this.push(paneId, status)
    } finally {
      this.probing.delete(root)
    }
  }

  private push(paneId: string, status: GitStatus | null): void {
    const p = this.panes.get(paneId)
    if (!p) return
    const sig = sigOf(status)
    if (p.sig === sig) return
    p.sig = sig
    this.onStatus(paneId, status)
  }
}
