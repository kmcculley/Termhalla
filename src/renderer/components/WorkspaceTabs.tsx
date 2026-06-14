import { useStore } from '../store'

export function WorkspaceTabs() {
  const { order, workspaces, activeId, setActive, newWorkspace, save } = useStore()
  return (
    <div data-testid="workspace-tabs" style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e' }}>
      {order.map(id => (
        <button key={id} data-testid={`tab-${id}`}
          onClick={() => setActive(id)}
          style={{ fontWeight: id === activeId ? 700 : 400 }}>
          {workspaces[id].name}
        </button>
      ))}
      <button data-testid="new-workspace" onClick={() => newWorkspace(`Workspace ${order.length + 1}`)}>+</button>
      <button data-testid="save-workspace"
        onClick={() => { if (activeId) save(activeId) }}>Save</button>
    </div>
  )
}
