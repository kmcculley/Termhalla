import { useEffect, useMemo, useState } from 'react'
import { useStore, paneCwd } from '../store'
import { buildPaletteItems, buildCommandItems, filterPaletteItems, type PaletteItem } from '@shared/quick'
import { dispatchCommand } from '../store/pane-ops'
import { clearPane, openPaneFind, redrawPane } from './terminal-registry'
import { Modal, Z } from './Modal'

// Palette action → shared command id (2026-07-17 audit Finding 28): the behavior of these
// commands lives ONCE in store/pane-ops.ts dispatchCommand, shared with App.tsx's chord handler;
// only the names differ between the palette items ('maximize-pane') and the chord commands
// ('toggle-maximize-pane'). All of these need an active workspace, so they are consulted below
// the activeId guard.
const SHARED_COMMANDS: Record<string, string> = {
  'new-terminal': 'new-terminal',
  settings: 'open-settings',
  'close-pane': 'close-pane',
  'maximize-pane': 'toggle-maximize-pane',
  'minimize-pane': 'toggle-minimize-pane',
  'clear-terminal': 'clear-terminal',
  'find-in-terminal': 'find-in-terminal',
  'redraw-terminal': 'redraw-terminal',
  'restore-last-minimized': 'restore-last-minimized'
}

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
  const newRemoteWorkspace = useStore(s => s.newRemoteWorkspace)
  const setBroadcastOpen = useStore(s => s.setBroadcastOpen)
  const saveAll = useStore(s => s.saveAll)
  const refreshCloud = useStore(s => s.refreshCloud)
  const pushToast = useStore(s => s.pushToast)
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

  // Commands show on the empty query too (QoL 2026-07-17) — the palette used to hide every
  // command until you typed, so it read as connect/jump-only.
  const items = useMemo(() => {
    const all = [...buildPaletteItems(quick, currentCwd), ...buildCommandItems()]
    return filterPaletteItems(all, query)
  }, [quick, currentCwd, query])

  const clampedSel = items.length ? Math.min(sel, items.length - 1) : 0

  useEffect(() => { if (open) { setQuery(''); setSel(0) } }, [open])
  useEffect(() => { setSel(0) }, [query])

  if (!open) return null

  const close = () => setOpen(false)

  // The shared command→action dispatch (2026-07-17 audit Finding 28): ONE implementation with
  // App.tsx's chord handler. The palette side redraws the chord target ('chord' — the shipped
  // divergence from the chord handler, which redraws the focused pane exactly).
  const runShared = (id: string) =>
    dispatchCommand(id, useStore.getState(), { clearPane, redrawPane, openPaneFind }, { redrawTarget: 'chord' })

  const activate = (item: PaletteItem) => {
    if (item.kind === 'connection') { launchConnection(item.id); close(); return }
    if (item.kind === 'dir') { launchDir(item.path); close(); return }
    if (item.action === 'new-connection') { setConnectionForm('new'); setOpen(false); return }
    if (item.action === 'pin-cwd') { pinDir(currentCwd); return /* keep open to show the new ★ */ }
    // The decision-queue drawer is window chrome, not a pane — it must toggle even with no
    // active workspace (feature 0006, REQ-002), so it is handled before the guard below. (This
    // and capture-orky-work keep their literal call-site shapes here — frozen TEST-329/TEST-495
    // pin them — rather than riding the shared dispatcher.)
    if (item.action === 'toggle-orky-queue') { setQueueOpen(!queueOpen); close(); return }
    // The global quick-capture modal is window chrome too (feature 0012, REQ-001) — it opens with
    // NO active workspace, so it is handled before the guard below (the toggle-orky-queue
    // precedent). No argument: the picker-first flow.
    if (item.action === 'capture-orky-work') { openOrkyCapture(); close(); return }
    // Window-chrome commands (QoL 2026-07-17) — no active workspace needed, same precedent; the
    // behavior itself is shared with the chord handler (audit Finding 28).
    if (item.action === 'toggle-notes' || item.action === 'font-zoom-reset') { runShared(item.action); close(); return }
    if (item.action === 'search-history') { useStore.getState().setSearchOpen(true); close(); return }
    // Commands below need an active workspace.
    if (!activeId) return
    // Pane-scoped commands target the focused pane (else the workspace's first pane), exactly
    // like their chords in App.tsx — the same dispatchCommand implementation.
    {
      const shared = SHARED_COMMANDS[item.action]
      if (shared) { runShared(shared); close(); return }
    }
    if (item.action === 'new-editor') void addPaneOfKind(activeId, 'editor')
    else if (item.action === 'new-explorer') void addPaneOfKind(activeId, 'explorer')
    else if (item.action === 'new-orky') void addPaneOfKind(activeId, 'orky')
    else if (item.action === 'new-workspace') newWorkspace(`Workspace ${order.length + 1}`)
    // Feature 0011 (REQ-003): the cockpit gesture — opens the F11-labelled picker, then the
    // picked project's cockpit workspace. Below the guard: no active workspace ⇒ the same
    // silent no-op new-workspace has (the spec-pinned precedent).
    else if (item.action === 'new-orky-workspace') void newOrkyWorkspace()
    else if (item.action === 'new-remote-workspace') void newRemoteWorkspace()
    else if (item.action === 'broadcast') setBroadcastOpen(true)
    else if (item.action === 'save-all') { void saveAll(); pushToast('Workspaces saved') }
    else if (item.action === 'refresh-cloud') refreshCloud()
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
                      onClick={e => {
                        e.stopPropagation()
                        if (window.confirm(`Delete SSH connection "${item.label}"?`)) deleteConnection(item.id)
                      }}>🗑</button>
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
