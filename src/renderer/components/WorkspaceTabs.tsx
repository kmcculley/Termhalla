import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore, aiState } from '../store'
import type { PaneKind } from '../store/pane-ops'
import { useTabDrag } from './use-tab-drag'
import { TemplatesMenu } from './TemplatesMenu'
import { Z, SURFACE } from './Modal'

function tabBadge(
  ws: Workspace,
  statuses: Record<string, TerminalStatus>,
  aiSessions: Record<string, AiSession>
): string {
  let needs = 0, busy = false, ai = false, aiAwaiting = false
  for (const paneId of Object.keys(ws.panes)) {
    const cfg = ws.panes[paneId].config
    if (cfg.kind !== 'terminal') continue
    const as = aiState({ aiSessions, statuses }, paneId)
    if (as) { ai = true; if (as === 'awaiting') aiAwaiting = true }
    if (!resolveAlerts(cfg.alerts).tabBadge) continue
    const st = statuses[paneId]?.state
    if (st === 'needs-input') needs++
    else if (st === 'busy') busy = true
  }
  const aiPart = ai ? (aiAwaiting ? ' ✨⏳' : ' ✨') : ''
  if (needs > 0) return `${aiPart} 🔔${needs}`
  if (busy) return `${aiPart} •`
  return aiPart
}

export function WorkspaceTabs() {
  // Scope the subscription so the always-mounted tab bar doesn't re-render on every per-pane
  // runtime change (cwds/procs/usage/cloud/recording all churn during terminal activity).
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, addPaneOfKind,
    renameWorkspace, closeWorkspace, moveWorkspace, setBroadcastOpen, broadcastOpen, openSettings
  } = useStore(useShallow(s => ({
    order: s.order, workspaces: s.workspaces, activeId: s.activeId, setActive: s.setActive,
    newWorkspace: s.newWorkspace, saveAll: s.saveAll, shells: s.shells,
    newTerminalShellId: s.newTerminalShellId, setNewTerminalShell: s.setNewTerminalShell,
    addPaneOfKind: s.addPaneOfKind,
    renameWorkspace: s.renameWorkspace, closeWorkspace: s.closeWorkspace,
    moveWorkspace: s.moveWorkspace, setBroadcastOpen: s.setBroadcastOpen, broadcastOpen: s.broadcastOpen,
    openSettings: s.openSettings
  })))
  // Derive the per-workspace badge string inside the selector: statuses/aiSessions change on
  // every line of output, but shallow-comparing the derived strings means we only re-render
  // when a badge's *text* actually changes.
  const badges = useStore(useShallow(s => {
    const out: Record<string, string> = {}
    for (const id of s.order) { const ws = s.workspaces[id]; if (ws) out[id] = tabBadge(ws, s.statuses, s.aiSessions) }
    return out
  }))

  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const { ghost, beginTabDrag } = useTabDrag(setActive, moveWorkspace)

  const startRename = (id: string) => { setRenameText(workspaces[id]?.name ?? ''); setRenamingId(id); setMenuFor(null) }
  const commitRename = (id: string) => { renameWorkspace(id, renameText); setRenamingId(null) }

  // Roving-tabindex arrow nav within the tablist (ArrowLeft/Right wrap; Home/End jump).
  const onTabKey = (id: string) => (e: React.KeyboardEvent) => {
    const i = order.indexOf(id)
    let next: string | undefined
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length]
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    else return
    e.preventDefault()
    if (next) { setActive(next); tabRefs.current.get(next)?.focus() }
  }

  return (
    <div data-testid="workspace-tabs" role="tablist" aria-label="Workspaces"
      style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel, #1e1e1e)', alignItems: 'center', fontSize: 'var(--font-size, 13px)' }}>
      {order.map(id => (
        renamingId === id ? (
          <input key={id} data-testid={`ws-rename-${id}`} autoFocus value={renameText}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setRenameText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(id); else if (e.key === 'Escape') setRenamingId(null) }}
            onBlur={() => commitRename(id)}
            style={{ width: 120 }} />
        ) : (
          <button key={id} data-testid={`tab-${id}`} data-tab-id={id}
            data-active={id === activeId}
            role="tab" aria-selected={id === activeId} tabIndex={id === activeId ? 0 : -1}
            ref={el => { if (el) tabRefs.current.set(id, el); else tabRefs.current.delete(id) }}
            onKeyDown={onTabKey(id)}
            onPointerDown={beginTabDrag(id)}
            onDoubleClick={() => startRename(id)}
            onContextMenu={e => { e.preventDefault(); setMenuFor({ id, x: e.clientX, y: e.clientY }) }}
            style={{ fontWeight: id === activeId ? 700 : 400 }}>
            {workspaces[id].name}{badges[id] ?? ''}
          </button>
        )
      ))}
      <button data-testid="new-workspace"
        onClick={() => { const id = newWorkspace(`Workspace ${order.length + 1}`); startRename(id) }}>+</button>
      <button data-testid="templates-button" title="Workspace templates"
        onClick={() => setTemplatesOpen(o => !o)}>▾</button>
      <span style={{ flex: 1 }} />
      <select data-testid="shell-picker" value={newTerminalShellId ?? ''}
        onChange={e => setNewTerminalShell(e.target.value)}>
        {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select data-testid="add-pane" value="" onChange={e => {
        const kind = e.target.value as PaneKind; e.currentTarget.value = ''
        if (activeId) void addPaneOfKind(activeId, kind)
      }}>
        <option value="" disabled>＋ pane…</option>
        <option value="terminal">Terminal</option>
        <option value="editor">Editor</option>
        <option value="explorer">Explorer</option>
      </select>
      <button data-testid="broadcast-button" title="Broadcast to all terminals (Ctrl+Shift+Enter)"
        onClick={() => setBroadcastOpen(!broadcastOpen)}>⇉</button>
      <button data-testid="settings-button" title="Settings (Ctrl+,)" onClick={() => openSettings({ section: 'general' })}>⚙</button>
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>

      {menuFor && (
        <>
          <div onClick={() => setMenuFor(null)} onContextMenu={e => { e.preventDefault(); setMenuFor(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
          <div data-testid="ws-menu"
            style={{ ...SURFACE, position: 'fixed', left: menuFor.x, top: menuFor.y, zIndex: Z.menu + 1, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size, 13px)' }}>
            <button data-testid="ws-menu-rename" onClick={() => startRename(menuFor.id)}>Rename</button>
            <button data-testid="ws-menu-save" onClick={() => { void saveAll(); setMenuFor(null) }}>Save</button>
            <button data-testid="ws-menu-close" onClick={() => {
              const ws = workspaces[menuFor.id]
              const ok = !ws || Object.keys(ws.panes).length === 0 ||
                window.confirm(`Close workspace "${ws.name}"? Its terminals will be closed.`)
              if (ok) closeWorkspace(menuFor.id)
              setMenuFor(null)
            }}>Close</button>
          </div>
        </>
      )}
      {ghost && (
        <div data-testid="tab-ghost"
          style={{ position: 'fixed', left: ghost.x + 8, top: ghost.y + 8, zIndex: Z.menu + 2, pointerEvents: 'none',
            padding: '2px 8px', background: 'var(--elevated, #333)', border: '1px solid var(--border, #555)', borderRadius: 4, opacity: 0.9 }}>
          {workspaces[ghost.id]?.name}
        </div>
      )}
      {templatesOpen && <TemplatesMenu onPicked={startRename} onClose={() => setTemplatesOpen(false)} />}
    </div>
  )
}
