/** File-rename fan-out (QoL batch 2026-07-17): the explorer emits after a successful fsRename so
 *  any editor pane holding the old path re-keys its tab to the new one instead of marking it
 *  "(deleted)" when the old path's unlink event lands. Renderer-local, imperative — the same
 *  pattern as the per-pane registries (this state is cross-component but not renderable). */
type Listener = (oldPath: string, newPath: string) => void
const listeners = new Set<Listener>()

export function onFileRenamed(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function emitFileRenamed(oldPath: string, newPath: string): void {
  for (const l of [...listeners]) l(oldPath, newPath)
}
