import { useCallback, useRef } from 'react'
import { api } from '../api'
import { draftKey } from '@shared/editor-draft'
import { AUTOSAVE_DEBOUNCE_MS } from '../timing'
import { useStore } from '../store'
import type { Tab } from './tabs'

/** Owns hot-exit draft persistence for one editor pane: one debounced timer per path.
 *  Persisting compares the buffer to its last-saved text — equal ⇒ drop the draft, else store it
 *  (with the disk baseline for on-reopen conflict detection). Keeping this out of EditorPane
 *  isolates the timer bookkeeping from the Monaco/tab glue. */
export function useEditorDrafts(paneId: string, getTab: (path: string) => Tab | undefined) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const getTabRef = useRef(getTab); getTabRef.current = getTab

  // Persist (or clear) the draft for one tab based on its current dirty state.
  const persist = useCallback((path: string) => {
    const t = getTabRef.current(path)
    if (!t || t.tooLarge) return
    const key = draftKey(paneId, path)
    const value = t.model.getValue()
    // Mirror the write into the renderer store so a same-session remount (pane transit) sees the
    // current draft, not the stale init snapshot — then persist to disk.
    if (value === t.saved) { useStore.getState().deleteDraft(key); api.draftsDelete(key) }
    else { const draft = { content: value, baseline: t.saved }; useStore.getState().setDraft(key, draft); api.draftsSet(key, draft) }
  }, [paneId])

  // Debounced persist on edit (shares the workspace autosave cadence).
  const schedule = useCallback((path: string) => {
    const existing = timers.current.get(path)
    if (existing) clearTimeout(existing)
    timers.current.set(path, setTimeout(() => { timers.current.delete(path); persist(path) }, AUTOSAVE_DEBOUNCE_MS))
  }, [persist])

  // Drop a single path's pending timer (on save/close — its draft is handled explicitly).
  const cancel = useCallback((path: string) => {
    const t = timers.current.get(path)
    if (t) { clearTimeout(t); timers.current.delete(path) }
  }, [])

  // Drop every pending timer (unmount / app close).
  const clearTimers = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
  }, [])

  return { persist, schedule, cancel, clearTimers }
}
