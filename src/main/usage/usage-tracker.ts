import chokidar, { type FSWatcher } from 'chokidar'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageMetrics } from '@shared/types'
import { encodeProjectDir, pickNewestTranscript } from './project-dir'
import { parseClaudeUsage } from './parse-usage'

interface Session { watcher: FSWatcher | null; timer: ReturnType<typeof setTimeout> | null }

/** Watches a Claude session's transcript (resolved from the terminal's cwd) and emits live
 *  usage metrics, re-parsing on change (debounced). Driven by usage:watch / usage:unwatch. */
export class UsageTracker {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly onMetrics: (id: string, m: UsageMetrics | null) => void,
    private readonly claudeHome: string = process.env.TERMHALLA_CLAUDE_HOME ?? join(homedir(), '.claude'),
    private readonly debounceMs = 750
  ) {}

  async watch(id: string, cwd: string): Promise<void> {
    this.stop(id) // replace any existing watch for this terminal (no clear emit)
    const file = await this.resolveTranscript(cwd)
    if (!file) { this.onMetrics(id, null); return }
    const sess: Session = { watcher: null, timer: null }
    this.sessions.set(id, sess)
    await this.reparse(id, file) // immediate
    if (!this.sessions.has(id)) return // unwatched during the await
    const w = chokidar.watch(file, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    w.on('change', () => this.schedule(id, file))
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

  private schedule(id: string, file: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => { void this.reparse(id, file) }, this.debounceMs)
  }

  private async reparse(id: string, file: string): Promise<void> {
    if (!this.sessions.has(id)) return
    let content: string
    try { content = await readFile(file, 'utf8') } catch { return }
    if (!this.sessions.has(id)) return
    this.onMetrics(id, parseClaudeUsage(content))
  }

  private async resolveTranscript(cwd: string): Promise<string | null> {
    const dir = join(this.claudeHome, 'projects', encodeProjectDir(cwd))
    let names: string[]
    try { names = await readdir(dir) } catch { return null }
    const entries = await Promise.all(names.filter(n => n.endsWith('.jsonl')).map(async n => {
      try { const s = await stat(join(dir, n)); return { name: n, mtimeMs: s.mtimeMs } } catch { return { name: n, mtimeMs: 0 } }
    }))
    const newest = pickNewestTranscript(entries)
    return newest ? join(dir, newest) : null
  }
}
