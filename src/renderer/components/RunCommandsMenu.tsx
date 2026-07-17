import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { addRunCommand, updateRunCommand, removeRunCommand } from '@shared/run-commands'
import type { RunCommand } from '@shared/types'
import { Modal } from './Modal'

type Scope = 'pane' | 'workspace'

/** Modal listing + editing a terminal's saved run commands (workspace- and pane-scoped) and
 *  running them. Sending reuses store.runCommand (encodeBroadcast keys+CR). Pane edits persist via
 *  updatePaneConfig; workspace edits via setWorkspaceRunCommands. */
export function RunCommandsMenu({ wsId, paneId, onClose }: { wsId: string; paneId: string; onClose: () => void }) {
  const ws = useStore(s => s.workspaces[wsId])
  const paneCfg = ws?.panes[paneId]?.config
  const paneCmds = paneCfg?.kind === 'terminal' ? paneCfg.runCommands : undefined
  const wsCmds = ws?.runCommands
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const setWorkspaceRunCommands = useStore(s => s.setWorkspaceRunCommands)
  const runCommand = useStore(s => s.runCommand)

  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [scope, setScope] = useState<Scope>('pane')
  const [editId, setEditId] = useState<string | null>(null)

  // Persist a new list for the given scope.
  const persist = (s: Scope, next: RunCommand[]) => {
    if (s === 'pane') updatePaneConfig(wsId, paneId, { runCommands: next })
    else setWorkspaceRunCommands(wsId, next)
  }
  const listFor = (s: Scope) => (s === 'pane' ? paneCmds : wsCmds)

  const resetForm = () => { setLabel(''); setCommand(''); setEditId(null); setScope('pane') }

  const submit = () => {
    const l = label.trim(); const c = command.trim()
    if (!l || !c) return
    if (editId) persist(scope, updateRunCommand(listFor(scope), editId, { label: l, command: c }))
    else persist(scope, addRunCommand(listFor(scope), { id: uuid(), label: l, command: c }))
    resetForm()
  }

  const startEdit = (s: Scope, cmd: RunCommand) => { setScope(s); setEditId(cmd.id); setLabel(cmd.label); setCommand(cmd.command) }
  const del = (s: Scope, cmd: RunCommand) => {
    if (!window.confirm(`Delete run command "${cmd.label}"?`)) return
    persist(s, removeRunCommand(listFor(s), cmd.id)); if (editId === cmd.id) resetForm()
  }
  const run = (command: string) => { runCommand(paneId, command); onClose() }

  const section = (s: Scope, title: string) => {
    const list = listFor(s) ?? []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>{title}</div>
        {list.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>None yet.</div>}
        {list.map(cmd => (
          <div key={cmd.id} data-testid={`run-row-${cmd.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button data-testid={`run-cmd-${cmd.id}`} onClick={() => run(cmd.command)}>▷</button>
            <span onClick={() => startEdit(s, cmd)} title={cmd.command}
              style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
              {cmd.label} — {cmd.command.split('\n')[0]}
            </span>
            <button data-testid={`run-del-${cmd.id}`} title="Delete" onClick={() => del(s, cmd)}>×</button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Modal onClose={onClose} backdropTestId="run-commands-dialog" card={{ padding: 12, width: 460 }}>
      <div style={{ fontWeight: 600 }}>Run commands</div>
      {section('workspace', 'This workspace')}
      {section('pane', 'This terminal')}
      <div style={{ borderTop: '1px solid var(--border, #444)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input data-testid="run-cmd-label" placeholder="Label (e.g. Test)" value={label}
          onChange={e => setLabel(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        <input data-testid="run-cmd-command" placeholder="Command (e.g. npm test)" value={command}
          onChange={e => setCommand(e.target.value)} style={{ fontFamily: 'var(--mono)' }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Scope:&nbsp;
            <select data-testid="run-cmd-scope" value={scope} onChange={e => setScope(e.target.value as Scope)} disabled={editId !== null}>
              <option value="pane">This terminal</option>
              <option value="workspace">This workspace</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {editId && <button data-testid="run-cmd-cancel" onClick={resetForm}>Cancel</button>}
          <button data-testid="run-cmd-add" disabled={!label.trim() || !command.trim()} onClick={submit}>
            {editId ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
