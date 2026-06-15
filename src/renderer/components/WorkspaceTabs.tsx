import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore, aiState } from '../store'
import { api } from '../api'

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
    if (as) {
      ai = true
      if (as === 'awaiting') aiAwaiting = true
    }
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
    setBroadcastOpen, broadcastOpen
  } = useStore()
  return (
    <div data-testid="workspace-tabs"
      style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e', alignItems: 'center' }}>
      {order.map(id => (
        <button key={id} data-testid={`tab-${id}`}
          onClick={() => setActive(id)}
          style={{ fontWeight: id === activeId ? 700 : 400 }}>
          {workspaces[id].name}{tabBadge(workspaces[id], statuses, aiSessions)}
        </button>
      ))}
      <button data-testid="new-workspace"
        onClick={() => newWorkspace(`Workspace ${order.length + 1}`)}>+</button>
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
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>
    </div>
  )
}
