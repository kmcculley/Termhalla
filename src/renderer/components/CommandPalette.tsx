import { useEffect, useMemo, useState } from 'react'
import { useStore, paneCwd } from '../store'
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
  const addPaneOfKind = useStore(s => s.addPaneOfKind)
  const newWorkspace = useStore(s => s.newWorkspace)
  const newOrkyWorkspace = useStore(s => s.newOrkyWorkspace)
  const setBroadcastOpen = useStore(s => s.setBroadcastOpen)
  const saveAll = useStore(s => s.saveAll)
  const refreshCloud = useStore(s => s.refreshCloud)
  const pushToast = useStore(s => s.pushToast)
  const openSettings = useStore(s => s.openSettings)
  const order = useStore(s => s.order)
  const queueOpen = useStore(s => s.queueOpen)
  const setQueueOpen = useStore(s => s.setQueueOpen)
  const openOrkyCapture = useStore(s => s.openOrkyCapture)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)

  // The "current" cwd for Pin = the first terminal pane's tracked cwd in the active workspace.
  // NOTE (FINDING-021 / TEST-495, tests/renderer/orky-capture-structure.test.ts:285): this hook is
  // deliberately shaped as a `activeId ? … : undefined` ternary rather than an early activeId-guard
  // return. TEST-495 locates the REAL command-activation guard by an UNANCHORED whole-file scan for
  // the activeId-guard literal; were this hook written with that same early-return form it would be
  // matched FIRST (it sits above the capture-orky-work case), pointing the frozen locator at the
  // wrong site. Do NOT revert to the early return — it would silently break that guard in another file.
  const currentCwd = useMemo(() => {
    const ws = activeId ? workspaces[activeId] : undefined
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
    // The decision-queue drawer is window chrome, not a pane — it must toggle even with no
    // active workspace (feature 0006, REQ-002), so it is handled before the guard below.
    if (item.action === 'toggle-orky-queue') { setQueueOpen(!queueOpen); close(); return }
    // The global quick-capture modal is window chrome too (feature 0012, REQ-001) — it opens with
    // NO active workspace, so it is handled before the guard below (the toggle-orky-queue
    // precedent). No argument: the picker-first flow.
    if (item.action === 'capture-orky-work') { openOrkyCapture(); close(); return }
    // Commands below need an active workspace.
    if (!activeId) return
    if (item.action === 'new-terminal') void addPaneOfKind(activeId, 'terminal')
    else if (item.action === 'new-editor') void addPaneOfKind(activeId, 'editor')
    else if (item.action === 'new-explorer') void addPaneOfKind(activeId, 'explorer')
    else if (item.action === 'new-orky') void addPaneOfKind(activeId, 'orky')
    else if (item.action === 'new-workspace') newWorkspace(`Workspace ${order.length + 1}`)
    // Feature 0011 (REQ-003): the cockpit gesture — opens the F11-labelled picker, then the
    // picked project's cockpit workspace. Below the guard: no active workspace ⇒ the same
    // silent no-op new-workspace has (the spec-pinned precedent).
    else if (item.action === 'new-orky-workspace') void newOrkyWorkspace()
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
