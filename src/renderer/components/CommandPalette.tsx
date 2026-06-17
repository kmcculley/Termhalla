import { useEffect, useMemo, useState } from 'react'
import { useStore, paneCwd } from '../store'
import { api } from '../api'
import { buildPaletteItems, buildCommandItems, filterPaletteItems, type PaletteItem } from '@shared/quick'
import { Modal, Z } from './Modal'

export function CommandPalette() {
  const open = useStore(s => s.paletteOpen)
  const setOpen = useStore(s => s.setPaletteOpen)
  const quick = useStore(s => s.quick)
  const activeId = useStore(s => s.activeId)
  const workspaces = useStore(s => s.workspaces)
  const cwds = useStore(s => s.cwds)
  const launchConnection = useStore(s => s.launchConnection)
  const launchDir = useStore(s => s.launchDir)
  const pinDir = useStore(s => s.pinDir)
  const unpinDir = useStore(s => s.unpinDir)
  const deleteConnection = useStore(s => s.deleteConnection)
  const setConnectionForm = useStore(s => s.setConnectionForm)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const newWorkspace = useStore(s => s.newWorkspace)
  const setBroadcastOpen = useStore(s => s.setBroadcastOpen)
  const saveAll = useStore(s => s.saveAll)
  const refreshCloud = useStore(s => s.refreshCloud)
  const pushToast = useStore(s => s.pushToast)
  const openSettings = useStore(s => s.openSettings)
  const order = useStore(s => s.order)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)

  // The "current" cwd for Pin = the first terminal pane's tracked cwd in the active workspace.
  const currentCwd = useMemo(() => {
    if (!activeId) return ''
    const ws = workspaces[activeId]
    if (!ws) return ''
    const termId = Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'terminal')
    return termId ? paneCwd({ cwds, workspaces }, termId) : ''
  }, [activeId, workspaces, cwds])

  const items = useMemo(() => {
    const base = buildPaletteItems(quick, currentCwd)
    const all = query.trim() ? [...base, ...buildCommandItems()] : base
    return filterPaletteItems(all, query)
  }, [quick, currentCwd, query])

  const clampedSel = items.length ? Math.min(sel, items.length - 1) : 0

  useEffect(() => { if (open) { setQuery(''); setSel(0) } }, [open])
  useEffect(() => { setSel(0) }, [query])

  if (!open) return null

  const close = () => setOpen(false)

  const activate = (item: PaletteItem) => {
    if (item.kind === 'connection') { launchConnection(item.id); close(); return }
    if (item.kind === 'dir') { launchDir(item.path); close(); return }
    if (item.action === 'new-connection') { setConnectionForm('new'); setOpen(false); return }
    if (item.action === 'pin-cwd') { pinDir(currentCwd); return /* keep open to show the new ★ */ }
    // Commands below need an active workspace.
    if (!activeId) return
    const ws = workspaces[activeId]
    const target = ws?.layout ? Object.keys(ws.panes)[0] : null
    if (item.action === 'new-terminal') addTerminal(activeId, target, 'row')
    else if (item.action === 'new-editor') addEditor(activeId, target, 'row')
    else if (item.action === 'new-explorer') { void api.openFolder().then(r => { if (r) addExplorer(activeId, target, 'row', r) }) }
    else if (item.action === 'new-workspace') newWorkspace(`Workspace ${order.length + 1}`)
    else if (item.action === 'broadcast') setBroadcastOpen(true)
    else if (item.action === 'save-all') { void saveAll(); pushToast('Workspaces saved') }
    else if (item.action === 'refresh-cloud') refreshCloud()
    else if (item.action === 'settings') openSettings({ section: 'general' })
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[clampedSel]) activate(items[clampedSel]) }
  }

  return (
    <Modal onClose={close} align="top" z={Z.palette}
      backdropTestId="command-palette-backdrop" cardTestId="command-palette"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'Command palette' }}
      card={{ width: 560, maxHeight: '60vh', gap: 0 }}>
        <input data-testid="palette-input" autoFocus value={query}
          onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Connect to… or jump to a directory"
          style={{ background: 'var(--panel, #1e1e1e)', color: 'var(--fg, #eee)', border: 'none', borderBottom: '1px solid var(--border, #444)',
            padding: '10px 12px', fontSize: 14, outline: 'none' }} />
        <div style={{ overflowY: 'auto' }} role="listbox" aria-label="Results">
          {items.length === 0 && <div style={{ padding: 12, color: 'var(--fg-dim, #aaa)' }}>No matches</div>}
          {items.map((item, i) => {
            const key = item.kind === 'connection' ? `c-${item.id}`
              : item.kind === 'dir' ? `d-${item.path}` : `a-${item.action}`
            const label = item.kind === 'connection' ? `🔌 ${item.label}`
              : item.kind === 'dir' ? `${item.favorite ? '★' : '⏱'} ${item.path}`
              : item.label
            const detail = item.kind === 'connection' ? item.detail : ''
            return (
              <div key={key} data-testid={`palette-item-${i}`} role="option" aria-selected={i === clampedSel}
                onMouseEnter={() => setSel(i)} onClick={() => activate(item)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  cursor: 'pointer', background: i === clampedSel ? 'var(--sel-bg)' : 'transparent' }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {detail && <span style={{ color: 'var(--fg-dim, #aaa)', fontSize: 12 }}>{detail}</span>}
                {item.kind === 'connection' && (
                  <>
                    <button data-testid={`palette-edit-${item.id}`} title="Edit"
                      onClick={e => { e.stopPropagation()
                        const c = quick.connections.find(x => x.id === item.id)
                        if (c) { setConnectionForm(c); setOpen(false) } }}>✎</button>
                    <button data-testid={`palette-delete-${item.id}`} title="Delete"
                      onClick={e => { e.stopPropagation(); deleteConnection(item.id) }}>🗑</button>
                  </>
                )}
                {item.kind === 'dir' && item.favorite && (
                  <button data-testid={`palette-unpin-${item.path}`} title="Unpin"
                    onClick={e => { e.stopPropagation(); unpinDir(item.path) }}>✕</button>
                )}
              </div>
            )
          })}
        </div>
    </Modal>
  )
}
