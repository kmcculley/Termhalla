import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { applyDirChange } from './explorer-tree'
import { basename as base, relativeTo } from '@shared/paths'
import type { DirEntry, ExplorerConfig } from '@shared/types'
import { INDENT_PX } from '../ui-tokens'
import { Z, SURFACE } from './Modal'

export function ExplorerPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: ExplorerConfig }) {
  const openFileInEditor = useStore(s => s.openFileInEditor)
  const pushToast = useStore(s => s.pushToast)
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ entry: DirEntry; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)  // path being renamed
  const [renameText, setRenameText] = useState('')
  const [errored, setErrored] = useState<Set<string>>(new Set())
  const watchedRef = useRef<Set<string>>(new Set())

  const loadDir = useCallback(async (dir: string) => {
    try {
      const entries = await api.fsReadDir(dir)
      setChildren(c => ({ ...c, [dir]: entries }))
      setErrored(e => { if (!e.has(dir)) return e; const n = new Set(e); n.delete(dir); return n })
    } catch {
      setErrored(e => new Set(e).add(dir))
      setChildren(c => ({ ...c, [dir]: [] }))
    }
    if (!watchedRef.current.has(dir)) { api.fsWatch(`${paneId}::${dir}`, dir); watchedRef.current.add(dir) }
  }, [paneId])

  const commitRename = async (entry: DirEntry) => {
    const name = renameText.trim()
    setRenaming(null)
    if (!name || name === entry.name) return
    const parent = entry.path.slice(0, entry.path.length - entry.name.length)
    try { await api.fsRename(entry.path, parent + name); pushToast('Renamed') }
    catch { pushToast('Rename failed', 'error') }
  }

  const del = async (entry: DirEntry) => {
    setMenu(null)
    if (!window.confirm(`Move "${entry.name}" to the Recycle Bin?`)) return
    try { await api.fsTrash(entry.path); pushToast('Moved to Recycle Bin') }
    catch { pushToast('Delete failed', 'error') }
  }

  const collapse = useCallback((dir: string) => {
    const isUnder = (p: string) => p === dir || p.startsWith(dir + '\\') || p.startsWith(dir + '/')
    for (const d of [...watchedRef.current]) {
      if (isUnder(d)) { api.fsUnwatch(`${paneId}::${d}`); watchedRef.current.delete(d) }
    }
    setExpanded(s => { const n = new Set([...s].filter(d => !isUnder(d))); return n })
    setChildren(c => {
      const n = { ...c }
      for (const d of Object.keys(n)) if (isUnder(d)) delete n[d]
      return n
    })
  }, [paneId])

  const toggle = useCallback((dir: string) => {
    if (expanded.has(dir)) { collapse(dir); return }
    setExpanded(s => new Set(s).add(dir))
    void loadDir(dir)
  }, [expanded, collapse, loadDir])

  // root: load + watch on mount / when root changes
  useEffect(() => {
    setExpanded(new Set([config.root]))
    void loadDir(config.root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.root])

  // live updates
  useEffect(() => {
    const off = api.onFsChange((id, change) => {
      const prefix = `${paneId}::`
      if (!id.startsWith(prefix)) return
      const dir = id.slice(prefix.length)
      setChildren(c => (c[dir] ? { ...c, [dir]: applyDirChange(c[dir], change) } : c))
    })
    return off
  }, [paneId])

  // cleanup all watches on unmount
  useEffect(() => () => {
    for (const dir of watchedRef.current) api.fsUnwatch(`${paneId}::${dir}`)
    watchedRef.current.clear()
  }, [paneId])

  const renderDir = (dir: string, depth: number) => {
    if (errored.has(dir)) return <div style={{ paddingLeft: depth * INDENT_PX + 6, color: 'var(--fg-dim, #aaa)' }}>Couldn't read folder</div>
    const loaded = children[dir]
    if (expanded.has(dir) && loaded && loaded.length === 0) return <div style={{ paddingLeft: depth * INDENT_PX + 6, color: 'var(--fg-dim, #aaa)' }}>Folder is empty</div>
    return (loaded ?? []).map(e => (
      <div key={e.path}>
        {renaming === e.path ? (
          <input data-testid={`rename-${base(e.path)}`} autoFocus value={renameText}
            onFocus={ev => ev.currentTarget.select()}
            onChange={ev => setRenameText(ev.target.value)}
            onKeyDown={ev => { if (ev.key === 'Enter') void commitRename(e); else if (ev.key === 'Escape') setRenaming(null) }}
            onBlur={() => void commitRename(e)}
            style={{ marginLeft: depth * INDENT_PX + 6, width: 160 }} />
        ) : (
          <div data-testid={`entry-${base(e.path)}`}
            onClick={() => e.isDir ? toggle(e.path) : openFileInEditor(wsId, e.path)}
            onContextMenu={ev => { ev.preventDefault(); setMenu({ entry: e, x: ev.clientX, y: ev.clientY }) }}
            style={{ paddingLeft: depth * INDENT_PX + 6, cursor: 'pointer', color: 'var(--fg, #ddd)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {e.isDir ? (expanded.has(e.path) ? '▾ ' : '▸ ') : '  '}{e.name}
          </div>
        )}
        {e.isDir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ))
  }

  return (
    <div data-testid={`explorer-${paneId}`} style={{ height: '100%', overflow: 'auto', background: 'var(--elevated, #252526)', fontFamily: 'var(--mono)', fontSize: 13 }}>
      <div style={{ padding: '4px 6px', color: 'var(--fg-dim, #aaa)' }}>{base(config.root)}</div>
      {renderDir(config.root, 0)}
      {menu && (
        <>
          <div onClick={() => setMenu(null)} onContextMenu={ev => { ev.preventDefault(); setMenu(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
          <div data-testid="explorer-menu"
            style={{ ...SURFACE, position: 'fixed', left: menu.x, top: menu.y, zIndex: Z.menu + 1, padding: 4,
              display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size, 13px)' }}>
            {!menu.entry.isDir && <button data-testid="explorer-open" onClick={() => { openFileInEditor(wsId, menu.entry.path); setMenu(null) }}>Open</button>}
            <button data-testid="explorer-reveal" onClick={() => { void api.fsRevealItem(menu.entry.path); setMenu(null) }}>Reveal in File Explorer</button>
            <button data-testid="explorer-copy-path" onClick={() => { api.clipboardWrite(menu.entry.path); pushToast('Path copied'); setMenu(null) }}>Copy path</button>
            <button data-testid="explorer-copy-rel" onClick={() => { api.clipboardWrite(relativeTo(config.root, menu.entry.path)); pushToast('Path copied'); setMenu(null) }}>Copy relative path</button>
            <button data-testid="explorer-rename" onClick={() => { setRenameText(menu.entry.name); setRenaming(menu.entry.path); setMenu(null) }}>Rename</button>
            <button data-testid="explorer-delete" onClick={() => void del(menu.entry)}>Delete</button>
          </div>
        </>
      )}
    </div>
  )
}
