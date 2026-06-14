import { useStore } from '../store'

export function WorkspaceTabs() {
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell
  } = useStore()
  return (
    <div data-testid="workspace-tabs"
      style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e', alignItems: 'center' }}>
      {order.map(id => (
        <button key={id} data-testid={`tab-${id}`}
          onClick={() => setActive(id)}
          style={{ fontWeight: id === activeId ? 700 : 400 }}>
          {workspaces[id].name}
        </button>
      ))}
      <button data-testid="new-workspace"
        onClick={() => newWorkspace(`Workspace ${order.length + 1}`)}>+</button>
      <span style={{ flex: 1 }} />
      <select data-testid="shell-picker" value={newTerminalShellId ?? ''}
        onChange={e => setNewTerminalShell(e.target.value)}>
        {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>
    </div>
  )
}
