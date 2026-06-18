import chokidar, { type FSWatcher } from 'chokidar'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageMetrics } from '@shared/types'
import { encodeProjectDir, pickNewestTranscript } from './project-dir'
import { parseClaudeUsage } from './parse-usage'
import { readModelAlias } from './model-alias'

interface Session {
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  dir: string
  alias: string
}

/** Watches a Claude session's transcript directory (resolved from the terminal's cwd) and emits
 *  live usage metrics, re-resolving the newest transcript and re-parsing on every change
 *  (debounced). Driven by usage:watch / usage:unwatch.
 *
 *  The directory — not a single fixed file — is watched, because the active transcript can change
 *  after the watch starts: a new session creates a new .jsonl, and the file that is "newest" at
 *  watch-start may be a stale/empty stub. Re-resolving on each event keeps us on the live file. */
export class UsageTracker {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly onMetrics: (id: string, m: UsageMetrics | null) => void,
    private readonly claudeHome: string = process.env.TERMHALLA_CLAUDE_HOME ?? join(homedir(), '.claude'),
    private readonly debounceMs = 750
  ) {}

  async watch(id: string, cwd: string): Promise<void> {
    this.stop(id) // remove any prior watch for this id (stop is silent — no emit)
    const sess: Session = { watcher: null, timer: null, dir: join(this.claudeHome, 'projects', encodeProjectDir(cwd)), alias: '' }
    this.sessions.set(id, sess) // claim the slot BEFORE awaiting so a concurrent watch/unwatch can supersede us
    sess.alias = await readModelAlias(cwd, this.claudeHome)
    if (this.sessions.get(id) !== sess) return // superseded during alias read
    await this.reparse(id, sess) // immediate parse of the current newest transcript
    if (this.sessions.get(id) !== sess) return // superseded during reparse
    const w = chokidar.watch(sess.dir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    const onEvt = (p: string): void => { if (p.endsWith('.jsonl')) this.schedule(id) }
    w.on('add', onEvt).on('change', onEvt)
    sess.watcher = w
  }

  unwatch(id: string): void {
    if (!this.sessions.has(id)) return
    this.stop(id)
    this.onMetrics(id, null)
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
    s.timer = setTimeout(() => { void this.reparse(id, s) }, this.debounceMs)
  }

  private async reparse(id: string, sess: Session): Promise<void> {
    if (this.sessions.get(id) !== sess) return
    const file = await this.resolveTranscript(sess.dir)
    if (this.sessions.get(id) !== sess) return
    if (!file) { this.onMetrics(id, null); return }
    let content: string
    try { content = await readFile(file, 'utf8') }
    catch (e) {
      // The transcript vanished/rotated between resolve and read (the dir is watched, so this is
      // plausible). Clear stale metrics rather than freezing the display on the last value, and
      // leave a diagnostic instead of swallowing the error silently.
      console.warn('[usage] failed to read transcript:', (e as Error).message)
      if (this.sessions.get(id) === sess) this.onMetrics(id, null)
      return
    }
    if (this.sessions.get(id) !== sess) return
    this.onMetrics(id, parseClaudeUsage(content, sess.alias))
  }

  private async resolveTranscript(dir: string): Promise<string | null> {
    let names: string[]
    try { names = await readdir(dir) } catch { return null }
    const entries = await Promise.all(names.filter(n => n.endsWith('.jsonl')).map(async n => {
      try { const s = await stat(join(dir, n)); return { name: n, mtimeMs: s.mtimeMs } } catch { return { name: n, mtimeMs: 0 } }
    }))
    const newest = pickNewestTranscript(entries)
    return newest ? join(dir, newest) : null
  }
}
