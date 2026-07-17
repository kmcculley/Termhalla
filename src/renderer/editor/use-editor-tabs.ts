import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import { monaco } from './monaco-setup'
import { languageForPath } from '@shared/language'
import { draftKey, resolveDraftOnOpen, UNTITLED, isUntitled } from '@shared/editor-draft'
import { api } from '../api'
import { useStore } from '../store'
import type { EditorConfig } from '@shared/types'
import { applyContent, base, isDirty, type Tab } from './tabs'
import { runOp } from '../op'
import { useEditorDrafts } from './use-editor-drafts'
import { useExternalFileWatch } from './use-external-file-watch'
import { useResolvedPaneTheme } from '../use-resolved-theme'
import { isPaneInTransit, endPaneTransit } from '../components/pane-transit'
import { registerFocuser, unregisterFocuser, registerDirtyCheck, unregisterDirtyCheck } from '../components/terminal-registry'
import { consumeReveal } from './reveal'
import { onFileRenamed } from './rename-bus'

/** The tab/model state + actions a rendered EditorPane needs. The Monaco editor instance,
 *  the tab→model map, draft persistence, save logic, the untitled scratch buffer, external-file
 *  reconciliation and per-pane theming all live here so the component is pure presentation. */
export interface EditorTabsApi {
  hostRef: RefObject<HTMLDivElement>
  order: string[]
  active: string | undefined
  activeTab: Tab | undefined
  getTab: (path: string) => Tab | undefined
  setActiveModel: (path: string, order?: string[]) => void
  openTab: (path: string) => Promise<void>
  closeTab: (path: string) => void
  clearUntitled: () => void
  saveUntitledAs: () => Promise<void>
  /** Save the tab at `path`'s buffer to a NEW file picked in a dialog and open it (QoL 2026-07-17
   *  — Save As used to exist only for the untitled scratch buffer). */
  saveTabAs: (path: string) => Promise<void>
  reloadActive: () => Promise<void>
  dismissExternalChange: () => void
}

export function useEditorTabs(paneId: string, wsId: string, config: EditorConfig): EditorTabsApi {
  const hostRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tabs = useRef<Map<string, Tab>>(new Map())
  const [order, setOrder] = useState<string[]>(config.files)
  const [active, setActive] = useState<string | undefined>(config.activePath ?? config.files[0])
  const [, force] = useState(0)
  const rerender = useCallback(() => force(x => x + 1), [])
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const registerEditorPane = useStore(s => s.registerEditorPane)

  const getTab = useCallback((path: string) => tabs.current.get(path), [])
  const { persist: persistDraft, schedule: scheduleDraftPersist, cancel: cancelDraftTimer, clearTimers: clearDraftTimers } = useEditorDrafts(paneId, getTab)

  const orderRef = useRef(order); orderRef.current = order
  const activeRef = useRef(active); activeRef.current = active
  const persist = useCallback((nextOrder: string[], nextActive: string | undefined) => {
    if (sameOrder(nextOrder, config.files) && nextActive === config.activePath) return
    updatePaneConfig(wsId, paneId, { files: nextOrder, activePath: nextActive })
  }, [wsId, paneId, config.files, config.activePath, updatePaneConfig])
  const persistRef = useRef(persist); useEffect(() => { persistRef.current = persist }, [persist])

  // `order` overrides the order to persist: callers that just changed the tab list (open/close)
  // pass the up-to-date array so the persisted `files` matches, instead of the by-one-render-stale
  // `orderRef.current`. Callers that only switch the active tab omit it.
  const setActiveModel = useCallback((path: string, order?: string[]) => {
    const t = tabs.current.get(path)
    if (t && edRef.current) edRef.current.setModel(t.model)
    setActive(path)
    persistRef.current(order ?? orderRef.current, isUntitled(path) ? undefined : path)
  }, [])

  const loading = useRef<Set<string>>(new Set())

  // Clear the untitled scratch buffer (the × on its tab) and drop its persisted draft.
  const clearUntitled = useCallback(() => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    applyContent(t.model, '')
    api.draftsDelete(draftKey(paneId, UNTITLED))
    cancelDraftTimer(UNTITLED)
    if (active === UNTITLED) { const f = orderRef.current[0]; if (f) setActiveModel(f) }
    rerender()
  }, [active, paneId, setActiveModel, rerender, cancelDraftTimer])

  // A terminal file:line link may have stashed a position for this path — jump there after the
  // model is active (consumed once; a plain open finds nothing and does nothing).
  const applyReveal = useCallback((path: string) => {
    const pos = consumeReveal(path)
    const ed = edRef.current
    if (!pos || !ed) return
    ed.revealLineInCenter(pos.line)
    ed.setPosition({ lineNumber: pos.line, column: pos.col ?? 1 })
    ed.focus()
  }, [])

  const openTab = useCallback(async (path: string) => {
    if (tabs.current.has(path)) { setActiveModel(path); applyReveal(path); return }
    if (loading.current.has(path)) return
    loading.current.add(path)
    try {
      let saved = '', tooLarge = false, missing = false, binary = false
      try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
      catch (err) {
        // A binary file EXISTS — it just can't display. Marking it missing rendered it
        // struck-through "(deleted)", which is a lie (QoL 2026-07-17).
        if (err instanceof Error && /binary/i.test(err.message)) binary = true
        else missing = true
      }
      const key = draftKey(paneId, path)
      const draft = useStore.getState().drafts[key]
      const resolved = tooLarge || binary
        ? { content: '', dirty: false, externalChanged: false }
        : resolveDraftOnOpen(missing ? null : saved, draft)
      const model = monaco.editor.createModel(resolved.content, languageForPath(path))
      const disp = model.onDidChangeContent(() => { rerender(); scheduleDraftPersist(path) })
      // Only surface the "changed on disk" bar when the restored draft actually differs from
      // disk; a stale draft equal to disk (deleted just below) shouldn't raise it.
      tabs.current.set(path, { path, model, saved, disp, tooLarge, missing, binary: binary || undefined, externalChanged: (resolved.dirty && resolved.externalChanged) || undefined })
      if (draft && !resolved.dirty) api.draftsDelete(key)  // stale draft equals disk
      api.fsWatch(key, path)
      const nextOrder = orderRef.current.includes(path) ? orderRef.current : [...orderRef.current, path]
      setOrder(nextOrder)
      setActiveModel(path, nextOrder)
      applyReveal(path)
      rerender()
    } finally {
      loading.current.delete(path)
    }
  }, [rerender, setActiveModel, scheduleDraftPersist, paneId, applyReveal])

  // Save the untitled scratch buffer to a new file: write it, drop its draft, clear it,
  // and open the saved file as a normal (clean) tab.
  const saveUntitledAs = useCallback(async () => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    const content = t.model.getValue()
    if (!content) return  // nothing to save (Ctrl+S on an empty scratch buffer)
    const path = await api.saveFileDialog()
    if (!path) return
    // Only drop the draft / clear the scratch buffer if the write actually succeeded — otherwise
    // a failed save would lose the buffer's content with no recovery draft.
    if (!await runOp(() => api.fsWrite(path, content), useStore.getState().pushToast, 'Save failed')) return
    api.draftsDelete(draftKey(paneId, UNTITLED))
    cancelDraftTimer(UNTITLED)
    applyContent(t.model, '')
    await openTab(path)
    rerender()
  }, [paneId, openTab, rerender, cancelDraftTimer])

  const saveActive = useCallback(async () => {
    if (!active) return
    if (isUntitled(active)) { await saveUntitledAs(); return }
    const t = tabs.current.get(active)
    if (!t || t.tooLarge || t.binary) return
    const value = t.model.getValue()
    // Mark the buffer clean / drop its draft only on a successful write — a failed save must keep
    // the buffer dirty and its recovery draft intact rather than silently lose the edits.
    if (!await runOp(() => api.fsWrite(active, value), useStore.getState().pushToast, 'Save failed')) return
    t.saved = value
    api.draftsDelete(draftKey(paneId, active))
    cancelDraftTimer(active)
    rerender()
  }, [active, rerender, paneId, saveUntitledAs, cancelDraftTimer])

  const saveActiveRef = useRef(saveActive)
  useEffect(() => { saveActiveRef.current = saveActive }, [saveActive])

  // Save As for a NAMED file (QoL 2026-07-17): write the tab's buffer to a dialog-picked path and
  // open the copy. The original tab keeps its state — this is "save a copy", the common ask.
  const saveTabAs = useCallback(async (path: string) => {
    if (isUntitled(path)) { await saveUntitledAs(); return }
    const t = tabs.current.get(path)
    if (!t || t.tooLarge || t.binary || t.missing) return
    const target = await api.saveFileDialog()
    if (!target || target === path) return
    if (!await runOp(() => api.fsWrite(target, t.model.getValue()), useStore.getState().pushToast, 'Save failed')) return
    await openTab(target)
  }, [openTab, saveUntitledAs])

  // Tear down one tab's Monaco model, watch, and persisted draft — no prompt, no order/persist
  // bookkeeping. Shared by closeTab (user-initiated) and the config-reconciliation effect.
  const dropTab = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t) return
    t.disp.dispose(); t.model.dispose(); tabs.current.delete(path)
    api.fsUnwatch(draftKey(paneId, path))
    api.draftsDelete(draftKey(paneId, path))
    cancelDraftTimer(path)
  }, [paneId, cancelDraftTimer])

  const closeTab = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t) return
    if (!t.tooLarge && !t.missing && !t.binary && t.model.getValue() !== t.saved) {
      if (!window.confirm(`${base(path)} has unsaved changes. Close anyway?`)) return
    }
    dropTab(path)
    // Compute the next order/active OUTSIDE the state updater, then apply: side effects
    // (model switch, persist) must not run inside setOrder's updater — React may invoke it
    // twice (StrictMode/batching), double-firing them.
    const next = orderRef.current.filter(p => p !== path)
    const nextActive = active === path ? next[next.length - 1] : active
    setOrder(next)
    if (nextActive) setActiveModel(nextActive, next)
    else { setActive(undefined); edRef.current?.setModel(null) }
    persist(next, nextActive)
    rerender()
  }, [active, persist, setActiveModel, rerender, dropTab])

  useEffect(() => {
    const q = useStore.getState().quick
    const ed = monaco.editor.create(hostRef.current!, {
      automaticLayout: true, theme: 'vs-dark', fontSize: 13,
      wordWrap: q.editorWordWrap ? 'on' : 'off',
      minimap: { enabled: q.editorMinimap === true }
    })
    edRef.current = ed
    registerEditorPane(paneId)
    registerFocuser(paneId, () => { ed.focus(); return ed.hasTextFocus() })
    // How many tabs would lose unsaved edits if this pane closed now — store.closePane consults
    // this so a pane close can't silently discard what the per-tab close would have confirmed.
    registerDirtyCheck(paneId, () => {
      let n = 0
      for (const t of tabs.current.values()) if (!t.tooLarge && !t.missing && t.model.getValue() !== t.saved) n++
      return n
    })
    const focusDisp = ed.onDidFocusEditorText(() => registerEditorPane(paneId))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActiveRef.current() })
    // One persistent untitled scratch buffer per pane (saved='' so the existing dirty/persist
    // logic treats any non-empty content as a draft). Seeded from the loaded drafts map.
    const untitledModel = monaco.editor.createModel(
      useStore.getState().drafts[draftKey(paneId, UNTITLED)]?.content ?? '', 'plaintext'
    )
    const untitledDisp = untitledModel.onDidChangeContent(() => { rerender(); scheduleDraftPersist(UNTITLED) })
    tabs.current.set(UNTITLED, { path: UNTITLED, model: untitledModel, saved: '', disp: untitledDisp, tooLarge: false, missing: false })
    if (config.files.length === 0) setActiveModel(UNTITLED)
    return () => {
      unregisterFocuser(paneId)
      unregisterDirtyCheck(paneId)
      focusDisp.dispose(); ed.dispose()
      clearDraftTimers()
      const moving = isPaneInTransit(paneId)
      for (const t of tabs.current.values()) {
        api.fsUnwatch(draftKey(paneId, t.path))
        // A move unmounts then remounts this pane: flush the draft so the remount restores unsaved
        // edits. A real close deletes it (no stale draft for a gone pane).
        if (moving) persistDraft(t.path)
        else api.draftsDelete(draftKey(paneId, t.path))
        t.disp.dispose(); t.model.dispose()
      }
      tabs.current.clear()
      if (moving) endPaneTransit(paneId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Best-effort flush of pending drafts when the whole app is closing. The draftSet/draftDelete
  // sends are queued synchronously here (in beforeunload) before the renderer is torn down; the
  // main process's win.on('close') -> DraftStore.flush() is the second safety net.
  useEffect(() => {
    const flush = () => {
      clearDraftTimers()
      for (const path of tabs.current.keys()) persistDraft(path)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [persistDraft, clearDraftTimers])

  // Ownership: this pane owns the live tab set (Monaco models in `tabs.current` + `order`).
  // `config.files` is the *initializer* (via useState above) and an additive source: when files
  // are added to config from elsewhere (e.g. openFileInEditor targeting this pane) we open them
  // here. Tab *removal* is driven locally by closeTab, which persists the shrunk list straight
  // back to config.files — so the two never drift in practice and this effect deliberately does
  // not remove tabs. (A removal pass here would race openTab, which is async: a freshly opened
  // path can be in `tabs.current` before the config snapshot this effect closes over reflects it,
  // wrongly tearing the new tab down. `dropTab` is the shared teardown used by closeTab.)
  useEffect(() => {
    for (const f of config.files) if (!tabs.current.has(f)) void openTab(f)
    if (config.activePath && tabs.current.has(config.activePath)) { setActiveModel(config.activePath); applyReveal(config.activePath) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.files, config.activePath])

  useExternalFileWatch(paneId, getTab, rerender)

  // Mirror "any tab dirty?" into the store after every render (edits force a rerender via the
  // model-change subscriptions), so the pane title's • stays live. Same-value writes are dropped.
  useEffect(() => {
    let dirty = false
    for (const t of tabs.current.values()) if (isDirty(t)) { dirty = true; break }
    useStore.getState().setEditorDirty(paneId, dirty)
  })

  // Follow an explorer rename into this pane's open tabs (QoL 2026-07-17): re-key the tab to the
  // new path (same model, same undo stack) instead of letting the old path's unlink event mark it
  // "(deleted)". Re-wires the watch and moves any recovery draft to the new key.
  useEffect(() => onFileRenamed((oldPath, newPath) => {
    const t = tabs.current.get(oldPath)
    if (!t) return
    tabs.current.delete(oldPath)
    t.path = newPath
    t.missing = false
    tabs.current.set(newPath, t)
    api.fsUnwatch(draftKey(paneId, oldPath))
    api.fsWatch(draftKey(paneId, newPath), newPath)
    api.draftsDelete(draftKey(paneId, oldPath))
    cancelDraftTimer(oldPath)
    if (t.model.getValue() !== t.saved) scheduleDraftPersist(newPath)
    const next = orderRef.current.map(p => (p === oldPath ? newPath : p))
    const nextActive = activeRef.current === oldPath ? newPath : activeRef.current
    setOrder(next)
    if (activeRef.current === oldPath) setActive(newPath)
    persistRef.current(next, nextActive && !isUntitled(nextActive) ? nextActive : undefined)
    rerender()
  }), [paneId, cancelDraftTimer, scheduleDraftPersist, rerender])

  // Editor display settings (QoL 2026-07-17): word wrap + minimap, app-wide, live-applied.
  const editorWordWrap = useStore(s => s.quick.editorWordWrap)
  const editorMinimap = useStore(s => s.quick.editorMinimap)
  useEffect(() => {
    edRef.current?.updateOptions({
      wordWrap: editorWordWrap ? 'on' : 'off',
      minimap: { enabled: editorMinimap === true }
    })
  }, [editorWordWrap, editorMinimap])

  // Per-pane theming: define a Monaco theme from the resolved app/ws/pane colors and apply it.
  const theme = useResolvedPaneTheme(wsId, config.theme)
  useEffect(() => {
    const ed = edRef.current
    if (!ed) return
    const name = `termhalla-${paneId}`
    try {
      monaco.editor.defineTheme(name, { base: 'vs-dark', inherit: true, rules: [],
        colors: { 'editor.background': theme.windowBg, 'editor.foreground': theme.text } })
      ed.updateOptions({ theme: name })
    } catch { /* invalid color */ }
  }, [theme, paneId])

  const reloadActive = useCallback(async () => {
    if (!active) return
    const t = tabs.current.get(active)
    if (!t) return
    const r = await api.fsRead(t.path).catch(() => null)
    if (r && !r.tooLarge) { t.saved = r.content; applyContent(t.model, r.content); t.externalChanged = false; rerender() }
  }, [active, rerender])

  const dismissExternalChange = useCallback(() => {
    if (!active) return
    const t = tabs.current.get(active)
    if (t) { t.externalChanged = false; rerender() }
  }, [active, rerender])

  const activeTab = active ? tabs.current.get(active) : undefined

  return {
    hostRef, order, active, activeTab, getTab, setActiveModel,
    openTab, closeTab, clearUntitled, saveUntitledAs, saveTabAs, reloadActive, dismissExternalChange
  }
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
