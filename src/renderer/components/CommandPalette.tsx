import { useEffect, useMemo, useState } from 'react'
import { useStore, paneCwd } from '../store'
import { buildPaletteItems, filterPaletteItems, type PaletteItem } from '@shared/quick'
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

  const items = useMemo(
    () => filterPaletteItems(buildPaletteItems(quick, currentCwd), query),
    [quick, currentCwd, query]
  )

  const clampedSel = items.length ? Math.min(sel, items.length - 1) : 0

  useEffect(() => { if (open) { setQuery(''); setSel(0) } }, [open])
  useEffect(() => { setSel(0) }, [query])

  if (!open) return null

  const close = () => setOpen(false)

  const activate = (item: PaletteItem) => {
    if (item.kind === 'connection') { launchConnection(item.id); close() }
    else if (item.kind === 'dir') { launchDir(item.path); close() }
    else if (item.action === 'new-connection') { setConnectionForm('new'); setOpen(false) }
    else if (item.action === 'pin-cwd') { pinDir(currentCwd) /* keep open to show the new ★ */ }
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
      card={{ width: 560, maxHeight: '60vh', gap: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <input data-testid="palette-input" autoFocus value={query}
          onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Connect to… or jump to a directory"
          style={{ background: 'var(--panel, #1e1e1e)', color: 'var(--fg, #eee)', border: 'none', borderBottom: '1px solid var(--border, #444)',
            padding: '10px 12px', fontSize: 14, outline: 'none' }} />
        <div style={{ overflowY: 'auto' }}>
          {items.length === 0 && <div style={{ padding: 12, opacity: 0.6 }}>No matches</div>}
          {items.map((item, i) => {
            const key = item.kind === 'connection' ? `c-${item.id}`
              : item.kind === 'dir' ? `d-${item.path}` : `a-${item.action}`
            const label = item.kind === 'connection' ? `🔌 ${item.label}`
              : item.kind === 'dir' ? `${item.favorite ? '★' : '⏱'} ${item.path}`
              : item.label
            const detail = item.kind === 'connection' ? item.detail : ''
            return (
              <div key={key} data-testid={`palette-item-${i}`}
                onMouseEnter={() => setSel(i)} onClick={() => activate(item)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  cursor: 'pointer', background: i === clampedSel ? '#094771' : 'transparent' }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {detail && <span style={{ opacity: 0.6, fontSize: 12 }}>{detail}</span>}
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
