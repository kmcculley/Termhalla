import { useEffect, useRef, useState, useCallback } from 'react'
import { monaco } from '../editor/monaco-setup'
import { languageForPath } from '@shared/language'
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
    persistRef.current(orderRef.current, path)
  }, [])

  const loading = useRef<Set<string>>(new Set())

  const openTab = useCallback(async (path: string) => {
    if (tabs.current.has(path)) { setActiveModel(path); return }
    if (loading.current.has(path)) return
    loading.current.add(path)
    try {
      let saved = '', tooLarge = false, missing = false
      try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
      catch { missing = true }
      const model = monaco.editor.createModel(tooLarge || missing ? '' : saved, languageForPath(path))
      const disp = model.onDidChangeContent(() => rerender())
      tabs.current.set(path, { path, model, saved, disp, tooLarge, missing })
      api.fsWatch(`${paneId}::${path}`, path)
      setOrder(o => (o.includes(path) ? o : [...o, path]))
      setActiveModel(path)
      rerender()
    } finally {
      loading.current.delete(path)
    }
  }, [rerender, setActiveModel])

  const saveActive = useCallback(async () => {
    if (!active) return
    const t = tabs.current.get(active)
    if (!t || t.tooLarge) return
    const value = t.model.getValue()
    await api.fsWrite(active, value)
    t.saved = value
    rerender()
  }, [active, rerender])

  const saveActiveRef = useRef(saveActive)
  useEffect(() => { saveActiveRef.current = saveActive }, [saveActive])

  const closeTab = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t) return
    if (!t.tooLarge && !t.missing && t.model.getValue() !== t.saved) {
      if (!window.confirm(`${base(path)} has unsaved changes. Close anyway?`)) return
    }
    t.disp.dispose(); t.model.dispose(); tabs.current.delete(path)
    api.fsUnwatch(`${paneId}::${path}`)
    setOrder(o => {
      const next = o.filter(p => p !== path)
      const nextActive = active === path ? next[next.length - 1] : active
      if (nextActive) setActiveModel(nextActive)
      else { setActive(undefined); edRef.current?.setModel(null) }
      persist(next, nextActive)
      return next
    })
    rerender()
  }, [active, persist, setActiveModel, rerender])

  useEffect(() => {
    const ed = monaco.editor.create(hostRef.current!, {
      automaticLayout: true, theme: 'vs-dark', minimap: { enabled: false }, fontSize: 13
    })
    edRef.current = ed
    registerEditorPane(paneId)
    const focusDisp = ed.onDidFocusEditorText(() => registerEditorPane(paneId))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActiveRef.current() })
    return () => {
      focusDisp.dispose(); ed.dispose()
      for (const t of tabs.current.values()) { api.fsUnwatch(`${paneId}::${t.path}`); t.disp.dispose(); t.model.dispose() }
      tabs.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

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
