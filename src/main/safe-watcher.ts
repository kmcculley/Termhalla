import chokidar, { type FSWatcher } from 'chokidar'

type WatchOpts = NonNullable<Parameters<typeof chokidar.watch>[1]>

/** chokidar.watch with a guaranteed 'error' listener. chokidar v4 re-emits non-ENOENT/ENOTDIR
 *  watch errors (Windows `EPERM ... watch` on deleting a watched dir, inotify ENOSPC); with zero
 *  'error' listeners that emit throws uncaught in the main process — Electron's default handler
 *  raises a modal error dialog that freezes the whole app. Every main-process watcher must be
 *  created through here (pinned by tests/main/safe-watcher.test.ts). */
export function safeWatch(path: string, tag: string, opts: WatchOpts): FSWatcher {
  const w = chokidar.watch(path, opts)
  attachWatcherErrorGuard(w, tag)
  return w
}

/** The guard itself, on a minimal structural seam so it is unit-testable with a plain
 *  EventEmitter. Warn-only: a watch error degrades that watcher's freshness, never the app. */
export function attachWatcherErrorGuard(
  w: { on(event: 'error', cb: (err: unknown) => void): unknown }, tag: string
): void {
  w.on('error', (err) => {
    console.warn(`[${tag}] watcher error:`, err instanceof Error ? err.message : String(err))
  })
}
