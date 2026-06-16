import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore, aiState } from '../store'
import { api } from '../api'
import { TemplatesMenu } from './TemplatesMenu'
import { ThemeEditor } from './ThemeEditor'
import { EnvManager } from './EnvManager'
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
    saveAll, shells, newTerminalShellId, setNewTerminalShell,
    addTerminal, addEditor, addExplorer,
    renameWorkspace, closeWorkspace, moveWorkspace, setBroadcastOpen, broadcastOpen
  } = useStore(useShallow(s => ({
    order: s.order, workspaces: s.workspaces, activeId: s.activeId, setActive: s.setActive,
    newWorkspace: s.newWorkspace, saveAll: s.saveAll, shells: s.shells,
    newTerminalShellId: s.newTerminalShellId, setNewTerminalShell: s.setNewTerminalShell,
    addTerminal: s.addTerminal, addEditor: s.addEditor, addExplorer: s.addExplorer,
    renameWorkspace: s.renameWorkspace, closeWorkspace: s.closeWorkspace,
    moveWorkspace: s.moveWorkspace, setBroadcastOpen: s.setBroadcastOpen, broadcastOpen: s.broadcastOpen
  })))
  // Derive the per-workspace badge string inside the selector: statuses/aiSessions change on
  // every line of output, but shallow-comparing the derived strings means we only re-render
  // when a badge's *text* actually changes.
  const badges = useStore(useShallow(s => {
    const out: Record<string, string> = {}
    for (const id of s.order) { const ws = s.workspaces[id]; if (ws) out[id] = tabBadge(ws, s.statuses, s.aiSessions) }
    return out
  }))

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; id: string } | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [envOpen, setEnvOpen] = useState(false)

  const startRename = (id: string) => { setRenameText(workspaces[id]?.name ?? ''); setRenamingId(id); setMenuFor(null) }
  const commitRename = (id: string) => { renameWorkspace(id, renameText); setRenamingId(null) }

  // Pointer-drag a tab: below a small threshold it's a click (activate); past it a ghost follows
  // the cursor. On release, an intra-strip drop reorders; otherwise main decides undock (off the
  // strip, into a new OS window) vs re-dock (onto another window's strip) from the screen position.
  const beginTabDrag = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const startX = e.clientX, startY = e.clientY
    let dragging = false
    const onMove = (me: PointerEvent) => {
      if (!dragging && Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return
      dragging = true
      setGhost({ x: me.clientX, y: me.clientY, id })
    }
    const onUp = (ue: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGhost(null)
      if (!dragging) { setActive(id); return }
      const overTab = (ue.target as HTMLElement | null)?.closest?.('[data-tab-id]') as HTMLElement | null
      const overId = overTab?.dataset.tabId
      if (overId && overId !== id) { moveWorkspace(id, overId); return }
      api.winDragEnd({ workspaceId: id, cursor: { x: ue.screenX, y: ue.screenY } })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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
          <button key={id} data-testid={`tab-${id}`} data-tab-id={id}
            data-active={id === activeId}
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
      <button data-testid="env-button" title="Environment variables" onClick={() => setEnvOpen(true)}>🔑</button>
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
      {themeOpen && <ThemeEditor onClose={() => setThemeOpen(false)} />}
      {envOpen && <EnvManager onClose={() => setEnvOpen(false)} />}
    </div>
  )
}
