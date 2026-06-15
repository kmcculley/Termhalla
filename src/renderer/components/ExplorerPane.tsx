import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { applyDirChange } from './explorer-tree'
import type { DirEntry, ExplorerConfig } from '@shared/types'

function base(p: string): string { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }

export function ExplorerPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: ExplorerConfig }) {
  const openFileInEditor = useStore(s => s.openFileInEditor)
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const watchedRef = useRef<Set<string>>(new Set())

  const loadDir = useCallback(async (dir: string) => {
    const entries = await api.fsReadDir(dir).catch(() => [] as DirEntry[])
    setChildren(c => ({ ...c, [dir]: entries }))
    if (!watchedRef.current.has(dir)) { api.fsWatch(`${paneId}::${dir}`, dir); watchedRef.current.add(dir) }
  }, [paneId])

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
    const entries = children[dir] ?? []
    return entries.map(e => (
      <div key={e.path}>
        <div data-testid={`entry-${base(e.path)}`}
          onClick={() => e.isDir ? toggle(e.path) : openFileInEditor(wsId, e.path)}
          style={{ paddingLeft: depth * 14 + 6, cursor: 'pointer', color: 'var(--fg, #ddd)', userSelect: 'none', whiteSpace: 'nowrap' }}>
          {e.isDir ? (expanded.has(e.path) ? '▾ ' : '▸ ') : '  '}{e.name}
        </div>
        {e.isDir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ))
  }

  return (
    <div data-testid={`explorer-${paneId}`} style={{ height: '100%', overflow: 'auto', background: 'var(--elevated, #252526)', fontFamily: 'Consolas, monospace', fontSize: 13 }}>
      <div style={{ padding: '4px 6px', color: '#999' }}>{base(config.root)}</div>
      {renderDir(config.root, 0)}
    </div>
  )
}
