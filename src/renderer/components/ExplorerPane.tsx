import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { applyDirChange } from './explorer-tree'
import { basename as base, relativeTo } from '@shared/paths'
import type { DirEntry, ExplorerConfig } from '@shared/types'
import { INDENT_PX } from '../ui-tokens'
import { MenuSurface } from './MenuSurface'
import { registerExplorerState, unregisterExplorerState, consumeExplorerState } from './explorer-registry'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef(expanded)
  const pendingScrollRef = useRef<number | null>(null)
  useEffect(() => { expandedRef.current = expanded }, [expanded])

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

  // root: load + watch on mount / when root changes. A minimize/restore remount rehydrates the
  // stashed expanded set + scroll so the tree restores exactly (REQ-012 / FINDING-DA-001 — kept-
  // mounted parity); otherwise (first mount or an actual root change, when no stash exists) reset to
  // root-only. The stash is paneId-scoped renderer memory, set by the store just before the unmount.
  useEffect(() => {
    const stashed = consumeExplorerState(paneId)
    if (stashed && stashed.expanded.length) {
      setExpanded(new Set(stashed.expanded))
      for (const dir of stashed.expanded) void loadDir(dir)
      pendingScrollRef.current = stashed.scroll
    } else {
      setExpanded(new Set([config.root]))
      void loadDir(config.root)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.root])

  // Expose this instance's live view-state (expanded folders + scroll) so the store can stash it
  // before a minimize/restore unmount; expandedRef mirrors the latest state for the getter.
  useEffect(() => {
    registerExplorerState(paneId, () => ({ expanded: [...expandedRef.current], scroll: containerRef.current?.scrollTop ?? 0 }))
    return () => unregisterExplorerState(paneId)
  }, [paneId])

  // After rehydrating expanded dirs, restore the stashed scroll once the tree has rendered tall
  // enough to accept it (best-effort; runs after each render until the scrollTop sticks).
  useEffect(() => {
    const el = containerRef.current
    if (pendingScrollRef.current == null || !el) return
    el.scrollTop = pendingScrollRef.current
    if (el.scrollTop === pendingScrollRef.current || el.scrollTop >= el.scrollHeight - el.clientHeight) pendingScrollRef.current = null
  })

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
    <div ref={containerRef} data-testid={`explorer-${paneId}`} style={{ height: '100%', overflow: 'auto', background: 'var(--elevated, #252526)', fontFamily: 'var(--mono)', fontSize: 13 }}>
      <div style={{ padding: '4px 6px', color: 'var(--fg-dim, #aaa)' }}>{base(config.root)}</div>
      {renderDir(config.root, 0)}
      {menu && (
        // portal: the explorer lives inside a react-mosaic tile (the MenuSurface containing-block
        // gotcha) — the clientX/clientY coords must resolve against the viewport, not the tile.
        <MenuSurface testid="explorer-menu" portal onClose={() => setMenu(null)}
          style={{ left: menu.x, top: menu.y, padding: 4, gap: 2, fontSize: 'var(--font-size, 13px)' }}>
          {!menu.entry.isDir && <button data-testid="explorer-open" onClick={() => { openFileInEditor(wsId, menu.entry.path); setMenu(null) }}>Open</button>}
          <button data-testid="explorer-reveal" onClick={() => { void api.fsRevealItem(menu.entry.path); setMenu(null) }}>Reveal in File Explorer</button>
          <button data-testid="explorer-copy-path" onClick={() => { api.clipboardWrite(menu.entry.path); pushToast('Path copied'); setMenu(null) }}>Copy path</button>
          <button data-testid="explorer-copy-rel" onClick={() => { api.clipboardWrite(relativeTo(config.root, menu.entry.path)); pushToast('Path copied'); setMenu(null) }}>Copy relative path</button>
          <button data-testid="explorer-rename" onClick={() => { setRenameText(menu.entry.name); setRenaming(menu.entry.path); setMenu(null) }}>Rename</button>
          <button data-testid="explorer-delete" onClick={() => void del(menu.entry)}>Delete</button>
        </MenuSurface>
      )}
    </div>
  )
}
