import { useEffect } from 'react'
import { api } from '../api'
import { applyContent, type Tab } from './tabs'

/** Reconciles open tabs with on-disk changes for one pane. Draft keys are `${paneId}::${path}`,
 *  so every fs event is filtered to this pane and mapped back to its tab:
 *   - unlink  → mark the tab missing (struck-through, "(deleted)")
 *   - change  → if the buffer is dirty, raise the "Changed on disk" bar; otherwise silently
 *               reload the new contents (a too-large reread is ignored).
 *  Lives in its own hook so EditorPane doesn't carry the watch wiring. */
export function useExternalFileWatch(paneId: string, getTab: (path: string) => Tab | undefined, rerender: () => void): void {
  useEffect(() => {
    const off = api.onFsChange((id, change) => {
      const prefix = `${paneId}::`
      if (!id.startsWith(prefix)) return
      const path = id.slice(prefix.length)
      const t = getTab(path)
      if (!t) return
      if (change.event === 'unlink') { t.missing = true; rerender(); return }
      if (change.event !== 'change') return
      const dirty = !t.tooLarge && !t.missing && !t.readError && t.model.getValue() !== t.saved
      if (dirty) { t.externalChanged = true; rerender(); return }
      void api.fsRead(path).then(r => {
        if (r.kind !== 'ok' || r.tooLarge) return
        // A successful reread also heals a readError tab: the file changed on disk and is
        // readable again, so the tab returns to a normal editable state.
        t.saved = r.content; applyContent(t.model, r.content); t.missing = false; t.readError = undefined; t.externalChanged = false; rerender()
      }).catch(() => {})
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])
}
