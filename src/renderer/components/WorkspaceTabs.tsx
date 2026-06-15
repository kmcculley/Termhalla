import { useState } from 'react'
import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore, aiState } from '../store'
import { api } from '../api'
import { TemplatesMenu } from './TemplatesMenu'
import { ThemeEditor } from './ThemeEditor'

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
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, statuses,
    addTerminal, addEditor, addExplorer, aiSessions,
    renameWorkspace, closeWorkspace, moveWorkspace, setBroadcastOpen, broadcastOpen
  } = useStore()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)

  const startRename = (id: string) => { setRenameText(workspaces[id]?.name ?? ''); setRenamingId(id); setMenuFor(null) }
  const commitRename = (id: string) => { renameWorkspace(id, renameText); setRenamingId(null) }

  return (
    <div data-testid="workspace-tabs"
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
          <button key={id} data-testid={`tab-${id}`}
            draggable
            onDragStart={() => setDraggedId(id)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (draggedId && draggedId !== id) moveWorkspace(draggedId, id); setDraggedId(null) }}
            onClick={() => setActive(id)}
            onDoubleClick={() => startRename(id)}
            onContextMenu={e => { e.preventDefault(); setMenuFor({ id, x: e.clientX, y: e.clientY }) }}
            style={{ fontWeight: id === activeId ? 700 : 400 }}>
            {workspaces[id].name}{tabBadge(workspaces[id], statuses, aiSessions)}
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
      <select data-testid="add-pane" value="" onChange={async e => {
        const kind = e.target.value; e.currentTarget.value = ''
        if (!activeId) return
        const ws = workspaces[activeId]
        const target = ws.layout ? Object.keys(ws.panes)[0] : null
        if (kind === 'terminal') addTerminal(activeId, target, 'row')
        else if (kind === 'editor') addEditor(activeId, target, 'row')
        else if (kind === 'explorer') { const r = await api.openFolder(); if (r) addExplorer(activeId, target, 'row', r) }
      }}>
        <option value="" disabled>＋ pane…</option>
        <option value="terminal">Terminal</option>
        <option value="editor">Editor</option>
        <option value="explorer">Explorer</option>
      </select>
      <button data-testid="broadcast-button" title="Broadcast to all terminals (Ctrl+Shift+Enter)"
        onClick={() => setBroadcastOpen(!broadcastOpen)}>⇉</button>
      <button data-testid="theme-button" title="Theme" onClick={() => setThemeOpen(true)}>🎨</button>
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>

      {menuFor && (
        <>
          <div onClick={() => setMenuFor(null)} onContextMenu={e => { e.preventDefault(); setMenuFor(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div data-testid="ws-menu"
            style={{ position: 'fixed', left: menuFor.x, top: menuFor.y, zIndex: 41, background: 'var(--elevated, #252526)',
              color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size, 13px)' }}>
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
      {templatesOpen && <TemplatesMenu onPicked={startRename} onClose={() => setTemplatesOpen(false)} />}
      {themeOpen && <ThemeEditor onClose={() => setThemeOpen(false)} />}
    </div>
  )
}
