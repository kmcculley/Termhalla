import chokidar, { type FSWatcher } from 'chokidar'
import type { FsChange, FsEvent } from '@shared/types'

const EVENTS: FsEvent[] = ['add', 'unlink', 'change', 'addDir', 'unlinkDir']

/** Manages per-id chokidar watchers (non-recursive). Forwards change events. */
export class WatchManager {
  private watchers = new Map<string, FSWatcher>()

  constructor(private readonly onChange: (id: string, change: FsChange) => void) {}

  watch(id: string, path: string): void {
    if (this.watchers.has(id)) this.unwatch(id)
    const w = chokidar.watch(path, {
      ignoreInitial: true, depth: 0,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
    })
    for (const ev of EVENTS) w.on(ev, ((p: string) => this.onChange(id, { event: ev, path: p })) as never)
    this.watchers.set(id, w)
  }

  unwatch(id: string): void {
    const w = this.watchers.get(id)
    if (w) { void w.close(); this.watchers.delete(id) }
  }

  closeAll(): void { for (const id of [...this.watchers.keys()]) this.unwatch(id) }
}
