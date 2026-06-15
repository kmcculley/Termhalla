import { useEffect, useRef, useState, useCallback } from 'react'
import { monaco } from '../editor/monaco-setup'
import { languageForPath } from '@shared/language'
import { draftKey, resolveDraftOnOpen, UNTITLED, isUntitled } from '@shared/editor-draft'
import { api } from '../api'
import { useStore } from '../store'
import type { EditorConfig } from '@shared/types'
import type { editor as monacoEditor } from 'monaco-editor'

function applyContent(model: monacoEditor.ITextModel, content: string): void {
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
}

interface Tab {
  path: string
  model: monaco.editor.ITextModel
  saved: string
  disp: monaco.IDisposable
  tooLarge: boolean
  missing: boolean
  externalChanged?: boolean
}

function base(p: string): string { return p.split(/[\\/]/).pop() ?? p }

export function EditorPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: EditorConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tabs = useRef<Map<string, Tab>>(new Map())
  const [order, setOrder] = useState<string[]>(config.files)
  const [active, setActive] = useState<string | undefined>(config.activePath ?? config.files[0])
  const [, force] = useState(0)
  const rerender = useCallback(() => force(x => x + 1), [])
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const registerEditorPane = useStore(s => s.registerEditorPane)

  const orderRef = useRef(order); orderRef.current = order
  const persist = useCallback((nextOrder: string[], nextActive: string | undefined) => {
    if (nextOrder.join(' ') === config.files.join(' ') && nextActive === config.activePath) return
    updatePaneConfig(wsId, paneId, { files: nextOrder, activePath: nextActive })
  }, [wsId, paneId, config.files, config.activePath, updatePaneConfig])
  const persistRef = useRef(persist); useEffect(() => { persistRef.current = persist }, [persist])

  const setActiveModel = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (t && edRef.current) edRef.current.setModel(t.model)
    setActive(path)
    persistRef.current(orderRef.current, isUntitled(path) ? undefined : path)
  }, [])

  const loading = useRef<Set<string>>(new Set())
  const draftTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Persist or clear the draft for one tab based on its current dirty state.
  const persistDraft = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t || t.tooLarge) return
    const key = draftKey(paneId, path)
    const value = t.model.getValue()
    if (value === t.saved) api.draftDelete(key)
    else api.draftSet(key, { content: value, baseline: t.saved })
  }, [paneId])

  // Debounced persist on edit (mirrors the workspace autosave cadence).
  const scheduleDraftPersist = useCallback((path: string) => {
    const timers = draftTimers.current
    const existing = timers.get(path)
    if (existing) clearTimeout(existing)
    timers.set(path, setTimeout(() => { timers.delete(path); persistDraft(path) }, 500))
  }, [persistDraft])

  // Clear the untitled scratch buffer (the × on its tab) and drop its persisted draft.
  const clearUntitled = useCallback(() => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    applyContent(t.model, '')
    api.draftDelete(draftKey(paneId, UNTITLED))
    const dt = draftTimers.current.get(UNTITLED); if (dt) { clearTimeout(dt); draftTimers.current.delete(UNTITLED) }
    if (active === UNTITLED) { const f = orderRef.current[0]; if (f) setActiveModel(f) }
    rerender()
  }, [active, paneId, setActiveModel, rerender])

  const openTab = useCallback(async (path: string) => {
    if (tabs.current.has(path)) { setActiveModel(path); return }
    if (loading.current.has(path)) return
    loading.current.add(path)
    try {
      let saved = '', tooLarge = false, missing = false
      try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
      catch { missing = true }
      const key = draftKey(paneId, path)
      const draft = useStore.getState().drafts[key]
      const resolved = tooLarge
        ? { content: '', dirty: false, externalChanged: false }
        : resolveDraftOnOpen(missing ? null : saved, draft)
      const model = monaco.editor.createModel(resolved.content, languageForPath(path))
      const disp = model.onDidChangeContent(() => { rerender(); scheduleDraftPersist(path) })
      // Only surface the "changed on disk" bar when the restored draft actually differs from
      // disk; a stale draft equal to disk (deleted just below) shouldn't raise it.
      tabs.current.set(path, { path, model, saved, disp, tooLarge, missing, externalChanged: (resolved.dirty && resolved.externalChanged) || undefined })
      if (draft && !resolved.dirty) api.draftDelete(key)  // stale draft equals disk
      api.fsWatch(key, path)
      setOrder(o => (o.includes(path) ? o : [...o, path]))
      setActiveModel(path)
      rerender()
    } finally {
      loading.current.delete(path)
    }
  }, [rerender, setActiveModel, scheduleDraftPersist])

  // Save the untitled scratch buffer to a new file: write it, drop its draft, clear it,
  // and open the saved file as a normal (clean) tab.
  const saveUntitledAs = useCallback(async () => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    const content = t.model.getValue()
    const path = await api.saveFileDialog()
    if (!path) return
    await api.fsWrite(path, content)
    api.draftDelete(draftKey(paneId, UNTITLED))
    const dt = draftTimers.current.get(UNTITLED); if (dt) { clearTimeout(dt); draftTimers.current.delete(UNTITLED) }
    applyContent(t.model, '')
    await openTab(path)
    rerender()
  }, [paneId, openTab, rerender])

  const saveActive = useCallback(async () => {
    if (!active) return
    if (isUntitled(active)) { await saveUntitledAs(); return }
    const t = tabs.current.get(active)
    if (!t || t.tooLarge) return
    const value = t.model.getValue()
    await api.fsWrite(active, value)
    t.saved = value
    api.draftDelete(draftKey(paneId, active))
    const dt = draftTimers.current.get(active); if (dt) { clearTimeout(dt); draftTimers.current.delete(active) }
    rerender()
  }, [active, rerender, paneId, saveUntitledAs])

  const saveActiveRef = useRef(saveActive)
  useEffect(() => { saveActiveRef.current = saveActive }, [saveActive])

  const closeTab = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t) return
    if (!t.tooLarge && !t.missing && t.model.getValue() !== t.saved) {
      if (!window.confirm(`${base(path)} has unsaved changes. Close anyway?`)) return
    }
    t.disp.dispose(); t.model.dispose(); tabs.current.delete(path)
    api.fsUnwatch(draftKey(paneId, path))
    api.draftDelete(draftKey(paneId, path))
    const dt = draftTimers.current.get(path); if (dt) { clearTimeout(dt); draftTimers.current.delete(path) }
    setOrder(o => {
      const next = o.filter(p => p !== path)
      const nextActive = active === path ? next[next.length - 1] : active
      if (nextActive) setActiveModel(nextActive)
      else { setActive(undefined); edRef.current?.setModel(null) }
      persist(next, nextActive)
      return next
    })
    rerender()
  }, [active, persist, setActiveModel, rerender, paneId])

  useEffect(() => {
    const ed = monaco.editor.create(hostRef.current!, {
      automaticLayout: true, theme: 'vs-dark', minimap: { enabled: false }, fontSize: 13
    })
    edRef.current = ed
    registerEditorPane(paneId)
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
      focusDisp.dispose(); ed.dispose()
      for (const t of draftTimers.current.values()) clearTimeout(t)
      draftTimers.current.clear()
      for (const t of tabs.current.values()) { api.fsUnwatch(draftKey(paneId, t.path)); api.draftDelete(draftKey(paneId, t.path)); t.disp.dispose(); t.model.dispose() }
      tabs.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Best-effort flush of pending drafts when the whole app is closing. The draftSet/draftDelete
  // sends are queued synchronously here (in beforeunload) before the renderer is torn down; the
  // main process's win.on('close') -> DraftStore.flush() is the second safety net.
  useEffect(() => {
    const flush = () => {
      for (const t of draftTimers.current.values()) clearTimeout(t)
      draftTimers.current.clear()
      for (const path of tabs.current.keys()) persistDraft(path)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [persistDraft])

  useEffect(() => {
    for (const f of config.files) if (!tabs.current.has(f)) void openTab(f)
    if (config.activePath && tabs.current.has(config.activePath)) setActiveModel(config.activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.files, config.activePath])

  useEffect(() => {
    const off = api.onFsChange((id, change) => {
      const prefix = `${paneId}::`
      if (!id.startsWith(prefix)) return
      const path = id.slice(prefix.length)
      const t = tabs.current.get(path)
      if (!t) return
      if (change.event === 'unlink') { t.missing = true; rerender(); return }
      if (change.event !== 'change') return
      const dirty = !t.tooLarge && !t.missing && t.model.getValue() !== t.saved
      if (dirty) { t.externalChanged = true; rerender(); return }
      void api.fsRead(path).then(r => {
        if (r.tooLarge) return
        t.saved = r.content; applyContent(t.model, r.content); t.missing = false; t.externalChanged = false; rerender()
      }).catch(() => {})
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  const activeTab = active ? tabs.current.get(active) : undefined
  const isDirty = (t: Tab | undefined) => !!t && !t.tooLarge && !t.missing && t.model.getValue() !== t.saved

  return (
    <div data-testid={`editor-${paneId}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div data-testid="editor-tabs" style={{ display: 'flex', background: '#1e1e1e', overflowX: 'auto' }}>
        {(() => {
          const ut = tabs.current.get(UNTITLED)
          const content = ut?.model.getValue() ?? ''
          if (order.length !== 0 && content === '') return null
          return (
            <div data-testid="tab-untitled" onClick={() => setActiveModel(UNTITLED)}
              style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
                background: active === UNTITLED ? '#333' : 'transparent', color: '#ddd', whiteSpace: 'nowrap' }}>
              <span>Untitled{content !== '' ? ' •' : ''}</span>
              {active === UNTITLED && content !== '' && (
                <button data-testid="untitled-saveas" title="Save As…"
                  onClick={e => { e.stopPropagation(); void saveUntitledAs() }}>Save As…</button>
              )}
              {order.length > 0 && (
                <button data-testid="tab-close-untitled" onClick={e => { e.stopPropagation(); clearUntitled() }}>×</button>
              )}
            </div>
          )
        })()}
        {order.length === 0 && (
          <button data-testid="editor-open-file" onClick={async () => { const p = await api.openFile(); if (p) void openTab(p) }}>
            Open File…
          </button>
        )}
        {order.map(p => {
          const t = tabs.current.get(p)
          return (
            <div key={p} data-testid={`tab-${base(p)}`} onClick={() => setActiveModel(p)}
              style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
                background: p === active ? '#333' : 'transparent', color: '#ddd', whiteSpace: 'nowrap' }}>
              <span style={{ textDecoration: t?.missing ? 'line-through' : 'none' }}>
                {base(p)}{isDirty(t) ? ' •' : ''}{t?.missing ? ' (deleted)' : ''}
              </span>
              <button data-testid={`tab-close-${base(p)}`} onClick={e => { e.stopPropagation(); closeTab(p) }}>×</button>
            </div>
          )
        })}
      </div>
      {activeTab?.tooLarge && <div data-testid="editor-toolarge" style={{ color: '#bbb', padding: 8 }}>File too large to open.</div>}
      {activeTab?.externalChanged && (
        <div data-testid="editor-reloadbar" style={{ background: '#5a4a00', color: '#fff', padding: '2px 8px', display: 'flex', gap: 8 }}>
          <span>Changed on disk.</span>
          <button data-testid="editor-reload" onClick={async () => {
            const t = activeTab; const r = await api.fsRead(t.path).catch(() => null)
            if (r && !r.tooLarge) { t.saved = r.content; applyContent(t.model, r.content); t.externalChanged = false; rerender() }
          }}>Reload</button>
          <button data-testid="editor-keepmine" onClick={() => { activeTab.externalChanged = false; rerender() }}>Keep mine</button>
        </div>
      )}
      <div ref={hostRef} style={{ flex: 1, display: activeTab?.tooLarge ? 'none' : 'block' }} />
    </div>
  )
}
